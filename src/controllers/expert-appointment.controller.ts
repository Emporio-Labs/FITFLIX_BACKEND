import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	AppointmentMode,
	MeetingStatus,
	OnboardingStep,
	UnifiedBookingStatus,
} from "../models/Enums";
import Slot from "../models/Slots";
import UnifiedBooking from "../models/UnifiedBooking";
import User from "../models/User";
import { releaseSlotCapacity } from "../services/slot-reservation.service";
import { updateSharedOnboardingStep } from "../utils/onboarding.service";
import {
	fromLegacySportsScientistStatus,
	serializeSportsScientistBooking,
	SPORTS_SCIENTIST_BOOKING_FILTER,
	toLegacySportsScientistStatus,
} from "../utils/sports-scientist-booking.dto";
import { combineSessionDateTime, ssRoomIdFor } from "../utils/zego-room";
import {
	acceptSportsScientistBookingSchema,
	rejectSportsScientistBookingSchema,
} from "../validators/expert-appointment.validator";

/**
 * Sports-scientist consultations now live in `UnifiedBooking` alongside the
 * nutritionist consult — see utils/sports-scientist-booking.dto.ts for why the
 * wire format (legacy `ExpertAppointment` shape, PascalCase `bookingStatus`)
 * is unchanged. `ExpertAppointment` itself is left in place, unwritten, as a
 * rollback path — see scripts/migrate-sports-scientist-bookings.ts.
 */

export const getAllBookingsForAdmin: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { status } = req.query;
		const query: Record<string, unknown> = { ...SPORTS_SCIENTIST_BOOKING_FILTER };

		if (typeof status === "string" && status.trim()) {
			const matched = fromLegacySportsScientistStatus(status.trim());
			if (!matched) {
				res.status(400).json({
					error: "Invalid status filter",
					code: "BAD_REQUEST",
				});
				return;
			}
			query.status = matched;
		}

		const bookings = await UnifiedBooking.find(query)
			.populate("userId", "username email phone")
			.sort({ createdAt: -1 })
			.lean();

		res
			.status(200)
			.json({ bookings: bookings.map(serializeSportsScientistBooking) });
	} catch (error) {
		next(error);
	}
};

export const acceptBooking: RequestHandler = async (req, res, next) => {
	try {
		const idParam = req.params.id;
		const id = typeof idParam === "string" ? idParam : undefined;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ error: "Invalid booking ID", code: "BAD_REQUEST" });
			return;
		}

		const parsed = acceptSportsScientistBookingSchema.safeParse(
			req.body ?? {},
		);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const { clinicLocation, assignedExpertId, assignedExpertName } =
			parsed.data;

		const booking = await UnifiedBooking.findOne({
			_id: id,
			...SPORTS_SCIENTIST_BOOKING_FILTER,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.status === UnifiedBookingStatus.COMPLETED ||
			booking.status === UnifiedBookingStatus.REJECTED ||
			booking.status === UnifiedBookingStatus.CANCELLED
		) {
			res.status(400).json({
				error: `Booking is already ${toLegacySportsScientistStatus(booking.status).toLowerCase()} and cannot be accepted`,
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		const now = new Date();

		let bookingDate = booking.bookingDate;
		let endTimeStr = booking.endTime;

		if (booking.slotId) {
			const slot = await Slot.findById(booking.slotId).lean();
			if (!slot || slot.capacity <= 0) {
				res.status(409).json({
					error:
						"Original slot is no longer available. The user has been asked to pick a new time.",
					code: "SLOT_NO_LONGER_AVAILABLE",
					booking: serializeSportsScientistBooking(booking),
				});
				return;
			}
			bookingDate = slot.date || booking.bookingDate;
			endTimeStr = slot.endTime || booking.endTime;
		}

		if (bookingDate && endTimeStr) {
			const appointmentEndInstant = combineSessionDateTime(
				bookingDate,
				endTimeStr,
			);
			if (
				appointmentEndInstant &&
				appointmentEndInstant.getTime() < now.getTime()
			) {
				res.status(409).json({
					error:
						"This appointment slot date/time has already passed. The user has been asked to pick a new time.",
					code: "SLOT_EXPIRED",
					booking: serializeSportsScientistBooking(booking),
				});
				return;
			}
		}

		let expertName = assignedExpertName ?? null;
		let expertIdObj: mongoose.Types.ObjectId | null = null;

		if (
			assignedExpertId &&
			mongoose.Types.ObjectId.isValid(assignedExpertId)
		) {
			expertIdObj = new mongoose.Types.ObjectId(assignedExpertId);
			if (!expertName) {
				const expertUser = await User.findById(expertIdObj).select(
					"username",
				);
				if (expertUser) {
					expertName = expertUser.username;
				}
			}
		}

		booking.status = UnifiedBookingStatus.CONFIRMED;
		booking.meetingStatus = MeetingStatus.SCHEDULED;
		booking.acceptedAt = new Date();

		// Mirrors nutritionist-booking.controller.ts's acceptBooking: `location`
		// is non-nullable on UnifiedBooking, so an empty submission just leaves
		// whatever was there (the ONLINE default set at creation, or a prior
		// value) rather than clearing it.
		if (clinicLocation) {
			booking.location = clinicLocation;
		}

		if (expertIdObj) {
			booking.expertId = expertIdObj;
			booking.expertModel = "User";
		}

		if (expertName) {
			booking.assignedExpertName = expertName;
		}

		// Ensure zegoRoomId exists for ONLINE mode — mirrors
		// nutritionist-booking.controller.ts's identical backfill-on-accept.
		// A booking accepted before this migration shipped (or one created by
		// some other path) may have reached CONFIRMED with no room yet.
		if (
			booking.appointmentMode === AppointmentMode.ONLINE &&
			!booking.zegoRoomId
		) {
			booking.zegoRoomId = ssRoomIdFor(booking._id);
		}

		await booking.save();

		res.status(200).json({
			message: "Sports scientist booking accepted",
			booking: serializeSportsScientistBooking(booking),
		});
	} catch (error) {
		next(error);
	}
};

export const rejectBooking: RequestHandler = async (req, res, next) => {
	try {
		const idParam = req.params.id;
		const id = typeof idParam === "string" ? idParam : undefined;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ error: "Invalid booking ID", code: "BAD_REQUEST" });
			return;
		}

		const parsed = rejectSportsScientistBookingSchema.safeParse(
			req.body ?? {},
		);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const { rejectionReason } = parsed.data;

		const booking = await UnifiedBooking.findOne({
			_id: id,
			...SPORTS_SCIENTIST_BOOKING_FILTER,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.status === UnifiedBookingStatus.REJECTED ||
			booking.status === UnifiedBookingStatus.COMPLETED
		) {
			res.status(400).json({
				error: `Booking is already ${toLegacySportsScientistStatus(booking.status).toLowerCase()} and cannot be rejected`,
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		if (booking.slotId) {
			await releaseSlotCapacity(booking.slotId.toString());
		}

		if (booking.userId) {
			try {
				await updateSharedOnboardingStep(
					booking.userId.toString(),
					OnboardingStep.SPORT_SCIENTIST_APPOINTMENT,
					false,
				);
			} catch (_err) {
				// Non-onboarding user or step not applicable
			}
		}

		booking.status = UnifiedBookingStatus.REJECTED;
		booking.rejectedAt = new Date();
		booking.rejectionReason = rejectionReason ?? null;

		await booking.save();

		res.status(200).json({
			message: "Sports scientist booking rejected",
			booking: serializeSportsScientistBooking(booking),
		});
	} catch (error) {
		next(error);
	}
};

export const completeBooking: RequestHandler = async (req, res, next) => {
	try {
		const idParam = req.params.id;
		const id = typeof idParam === "string" ? idParam : undefined;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ error: "Invalid booking ID", code: "BAD_REQUEST" });
			return;
		}

		const booking = await UnifiedBooking.findOne({
			_id: id,
			...SPORTS_SCIENTIST_BOOKING_FILTER,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (booking.status !== UnifiedBookingStatus.CONFIRMED) {
			res.status(400).json({
				error: "Only a confirmed booking can be marked completed",
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		booking.status = UnifiedBookingStatus.COMPLETED;
		booking.meetingStatus = MeetingStatus.COMPLETED;
		booking.completedAt = new Date();

		await booking.save();

		res.status(200).json({
			message: "Sports scientist consultation marked complete",
			booking: serializeSportsScientistBooking(booking),
		});
	} catch (error) {
		next(error);
	}
};
