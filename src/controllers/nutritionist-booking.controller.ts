import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	NutritionistApprovalStatus,
	NutritionistBookingStatus,
	OnboardingStep,
} from "../models/Enums";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import {
	OnboardingServiceError,
	advanceStep,
} from "../utils/onboarding.service";
import {
	acceptBookingBodySchema,
	bookNutritionistBodySchema,
	listNutritionistBookingsQuerySchema,
	rejectBookingBodySchema,
} from "../validators/nutritionist-booking.validator";

type ZodIssue = { path: PropertyKey[]; message: string };

const getValidationDetails = (issues: ZodIssue[]) => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field =
			issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}
	return details;
};

const ACTIVE_BOOKING_STATUSES: NutritionistBookingStatus[] = [
	NutritionistBookingStatus.PENDING,
	NutritionistBookingStatus.ACCEPTED,
];

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

const normalizeToUtcDayStart = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const isSameUtcDate = (left: Date, right: Date): boolean =>
	normalizeToUtcDayStart(left).getTime() ===
	normalizeToUtcDayStart(right).getTime();

const resolveConcreteSlot = async (
	slot: {
		_id: mongoose.Types.ObjectId;
		date?: Date | null;
		isDaily?: boolean;
		startTime: string;
		endTime: string;
		capacity?: number;
		parentTemplate?: mongoose.Types.ObjectId | null;
	},
	bookingDay: Date,
) => {
	if (slot.parentTemplate) {
		if (!slot.date || !isSameUtcDate(slot.date, bookingDay)) return null;
		return slot;
	}

	if (slot.isDaily) {
		const templateCapacity = Math.max(1, Number(slot.capacity ?? 1));
		return await Slot.findOneAndUpdate(
			{
				parentTemplate: slot._id,
				date: bookingDay,
				startTime: slot.startTime,
				endTime: slot.endTime,
			},
			{
				$setOnInsert: {
					date: bookingDay,
					isDaily: false,
					startTime: slot.startTime,
					endTime: slot.endTime,
					capacity: templateCapacity,
					remainingCapacity: templateCapacity,
					isBooked: templateCapacity <= 0,
					parentTemplate: slot._id,
				},
			},
			{
				upsert: true,
				setDefaultsOnInsert: true,
				returnDocument: "after",
			},
		);
	}

	if (!slot.date || !isSameUtcDate(slot.date, bookingDay)) return null;
	return slot;
};

const reserveSlotCapacity = async (slotId: string) => {
	const reserved = await Slot.findOneAndUpdate(
		{ _id: slotId, remainingCapacity: { $gt: 0 } },
		{ $inc: { remainingCapacity: -1 } },
		{ returnDocument: "after" },
	);

	if (!reserved) return null;

	if (Number(reserved.remainingCapacity ?? 0) <= 0 && !reserved.isBooked) {
		await Slot.findByIdAndUpdate(slotId, { isBooked: true });
	}

	return reserved;
};

const releaseSlotCapacity = async (slotId: string) => {
	await Slot.findOneAndUpdate(
		{
			_id: slotId,
			$expr: {
				$lt: [
					{ $ifNull: ["$remainingCapacity", 0] },
					{ $ifNull: ["$capacity", 1] },
				],
			},
		},
		{
			$inc: { remainingCapacity: 1 },
			$set: { isBooked: false },
		},
	);
};

export const bookNutritionist: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can book nutritionist appointments",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsed = bookNutritionistBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { slotId, date, appointmentMode, clinicLocation } = parsed.data;
	const bookingDay = normalizeToUtcDayStart(date);

	if (bookingDay.getTime() < normalizeToUtcDayStart(new Date()).getTime()) {
		res.status(400).json({
			error: "Booking date cannot be in the past",
			code: "BAD_REQUEST",
		});
		return;
	}

	let reservedSlotId: string | null = null;

	try {
		const existingActive = await NutritionistBooking.findOne({
			user: req.user.id,
			bookingStatus: { $in: ACTIVE_BOOKING_STATUSES },
		});

		if (existingActive) {
			res.status(409).json({
				error:
					"You already have an active nutritionist booking. Cancel it before booking a new one.",
				code: "CONFLICT",
				bookingId: existingActive._id,
			});
			return;
		}

		const slot = await Slot.findById(slotId).select(
			"_id date isDaily startTime endTime capacity remainingCapacity isBooked parentTemplate",
		);

		if (!slot) {
			res.status(404).json({ error: "Slot not found", code: "NOT_FOUND" });
			return;
		}

		const concrete = await resolveConcreteSlot(slot, bookingDay);

		if (!concrete) {
			res.status(409).json({
				error: "Slot is not available for the selected date",
				code: "CONFLICT",
			});
			return;
		}

		const reserved = await reserveSlotCapacity(concrete._id.toString());
		if (!reserved) {
			res.status(409).json({
				error: "Slot is full or no longer available",
				code: "CONFLICT",
			});
			return;
		}

		const concreteReservedSlotId = reserved._id.toString();
		reservedSlotId = concreteReservedSlotId;

		const booking = await NutritionistBooking.create({
			user: req.user.id,
			slot: concreteReservedSlotId,
			date: bookingDay,
			startTime: concrete.startTime,
			endTime: concrete.endTime,
			appointmentMode,
			bookingStatus: NutritionistBookingStatus.PENDING,
			nutritionistApprovalStatus: NutritionistApprovalStatus.PENDING,
			...(clinicLocation ? { clinicLocation } : {}),
		});

		try {
			await advanceStep(req.user.id, OnboardingStep.NUTRITIONIST_BOOKING);
		} catch (error) {
			if (!(error instanceof OnboardingServiceError)) throw error;
		}

		res.status(201).json({
			message: "Nutritionist booking submitted for approval",
			booking,
		});
	} catch (error) {
		if (reservedSlotId) {
			await releaseSlotCapacity(reservedSlotId).catch(() => null);
		}
		next(error);
	}
};

export const listNutritionistBookings: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({
			error: "Only admins/frontdesk can list nutritionist bookings",
			code: "FORBIDDEN",
		});
		return;
	}

	const parsed = listNutritionistBookingsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const filter: Record<string, unknown> = {};

		if (parsed.data.status) {
			filter.bookingStatus = parsed.data.status;
		}

		if (parsed.data.date) {
			const dayStart = normalizeToUtcDayStart(parsed.data.date);
			const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
			filter.date = { $gte: dayStart, $lt: dayEnd };
		}

		const bookings = await NutritionistBooking.find(filter)
			.populate("user", "username email phone")
			.populate("slot", "date startTime endTime capacity remainingCapacity")
			.sort({ createdAt: -1 });

		res.status(200).json({ bookings, total: bookings.length });
	} catch (error) {
		next(error);
	}
};

export const acceptNutritionistBooking: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({
			error: "Only admins/frontdesk can approve nutritionist bookings",
			code: "FORBIDDEN",
		});
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res
			.status(400)
			.json({ error: "Invalid booking id", code: "BAD_REQUEST" });
		return;
	}

	const parsed = acceptBookingBodySchema.safeParse(req.body ?? {});
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const booking = await NutritionistBooking.findById(id);

		if (!booking) {
			res
				.status(404)
				.json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (booking.bookingStatus !== NutritionistBookingStatus.PENDING) {
			res.status(409).json({
				error: `Cannot accept booking in '${booking.bookingStatus}' state`,
				code: "CONFLICT",
			});
			return;
		}

		const update: Record<string, unknown> = {
			bookingStatus: NutritionistBookingStatus.ACCEPTED,
			nutritionistApprovalStatus: NutritionistApprovalStatus.APPROVED,
			acceptedAt: new Date(),
			approvedBy: req.user.id,
		};

		if (parsed.data.meetingLink) update.meetingLink = parsed.data.meetingLink;
		if (parsed.data.clinicLocation)
			update.clinicLocation = parsed.data.clinicLocation;
		if (parsed.data.calBookingId)
			update.calBookingId = parsed.data.calBookingId;

		const updated = await NutritionistBooking.findOneAndUpdate(
			{ _id: id, bookingStatus: NutritionistBookingStatus.PENDING },
			update,
			{ returnDocument: "after", runValidators: true },
		);

		if (!updated) {
			res.status(409).json({
				error: "Booking state changed; please refresh and retry",
				code: "CONFLICT",
			});
			return;
		}

		res.status(200).json({
			message: "Nutritionist booking accepted",
			booking: updated,
		});
	} catch (error) {
		next(error);
	}
};

export const rejectNutritionistBooking: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({
			error: "Only admins/frontdesk can reject nutritionist bookings",
			code: "FORBIDDEN",
		});
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res
			.status(400)
			.json({ error: "Invalid booking id", code: "BAD_REQUEST" });
		return;
	}

	const parsed = rejectBookingBodySchema.safeParse(req.body ?? {});
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const booking = await NutritionistBooking.findById(id);

		if (!booking) {
			res
				.status(404)
				.json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.bookingStatus === NutritionistBookingStatus.REJECTED ||
			booking.bookingStatus === NutritionistBookingStatus.COMPLETED
		) {
			res.status(409).json({
				error: `Cannot reject booking in '${booking.bookingStatus}' state`,
				code: "CONFLICT",
			});
			return;
		}

		const updated = await NutritionistBooking.findOneAndUpdate(
			{
				_id: id,
				bookingStatus: {
					$in: [
						NutritionistBookingStatus.PENDING,
						NutritionistBookingStatus.ACCEPTED,
					],
				},
			},
			{
				bookingStatus: NutritionistBookingStatus.REJECTED,
				nutritionistApprovalStatus: NutritionistApprovalStatus.REJECTED,
				rejectedAt: new Date(),
				approvedBy: req.user.id,
				...(parsed.data.reason ? { rejectionReason: parsed.data.reason } : {}),
			},
			{ returnDocument: "after", runValidators: true },
		);

		if (!updated) {
			res.status(409).json({
				error: "Booking state changed; please refresh and retry",
				code: "CONFLICT",
			});
			return;
		}

		await releaseSlotCapacity(updated.slot.toString());

		res.status(200).json({
			message: "Nutritionist booking rejected; slot capacity restored",
			booking: updated,
		});
	} catch (error) {
		next(error);
	}
};

export const getMyNutritionistBooking: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can view their own booking",
			code: "FORBIDDEN",
		});
		return;
	}

	try {
		const booking = await NutritionistBooking.findOne({
			user: req.user.id,
			bookingStatus: { $in: ACTIVE_BOOKING_STATUSES },
		})
			.populate("slot", "date startTime endTime capacity remainingCapacity")
			.sort({ createdAt: -1 });

		if (!booking) {
			const latest = await NutritionistBooking.findOne({ user: req.user.id })
				.populate(
					"slot",
					"date startTime endTime capacity remainingCapacity",
				)
				.sort({ createdAt: -1 });

			if (!latest) {
				res.status(404).json({
					error: "No nutritionist booking found",
					code: "NOT_FOUND",
				});
				return;
			}

			res.status(200).json({ booking: latest });
			return;
		}

		res.status(200).json({ booking });
	} catch (error) {
		next(error);
	}
};
