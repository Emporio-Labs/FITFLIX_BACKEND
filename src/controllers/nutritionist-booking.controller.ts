import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { mapCalBookingToAppointmentFields } from "../integrations/calid/calid.mapper";
import * as calidService from "../integrations/calid/calid.service";
import {
	AppointmentBookingStatus,
	AppointmentMode,
	AppointmentSource,
	ExpertType,
	NutritionistApprovalStatus,
	NutritionistBookingStatus,
	OnboardingStep,
	WebhookSyncStatus,
} from "../models/Enums";
import ExpertAppointment from "../models/ExpertAppointment";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import User from "../models/User";
import {
	advanceStep,
	OnboardingServiceError,
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

	if (slotId.includes("T") || slotId.includes("-")) {
		try {
			// 1. Race guard
			const existingActive = await ExpertAppointment.findOne({
				userId: req.user.id,
				expertType: ExpertType.Nutritionist,
				bookingStatus: {
					$in: [
						AppointmentBookingStatus.Pending,
						AppointmentBookingStatus.Confirmed,
						AppointmentBookingStatus.Rescheduled,
					],
				},
			}).lean();

			if (existingActive) {
				const bookingDate = existingActive.appointmentEnd || existingActive.appointmentStart || existingActive.appointmentDate || existingActive.createdAt;
				const hasEnded = bookingDate && new Date(bookingDate).getTime() < Date.now();
				if (!hasEnded) {
					res.status(409).json({
						error: "You already have a nutritionist booking.",
						code: "CONFLICT",
					});
					return;
				}
			}

			// 2. Fetch user details
			const dbUser = await User.findById(req.user.id)
				.select("username email")
				.lean();
			if (!dbUser) {
				res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
				return;
			}

			let attendeeEmail = dbUser.email;
			const bodyEmail = parsed.data.email;

			if (bodyEmail) {
				if (dbUser.email !== bodyEmail) {
					await User.findByIdAndUpdate(req.user.id, { $set: { email: bodyEmail } });
				}
				attendeeEmail = bodyEmail;
			} else if (!attendeeEmail) {
				res.status(400).json({
					error: "Email address is required to book a nutritionist appointment.",
					code: "EMAIL_REQUIRED",
				});
				return;
			}

			// 3. Create booking on Cal.id
			const calBooking = await calidService.createBooking({
				expertType: ExpertType.Nutritionist,
				slotStart: slotId,
				timezone: "Asia/Kolkata",
				attendee: { name: dbUser.username, email: attendeeEmail },
				userId: req.user.id,
			});

			// 4. Save to ExpertAppointment
			const calFields = mapCalBookingToAppointmentFields(calBooking);
			let appointment;
			try {
				appointment = await ExpertAppointment.create({
					userId: req.user.id,
					expertType: ExpertType.Nutritionist,
					bookingStatus: AppointmentBookingStatus.Confirmed,
					timezone: "Asia/Kolkata",
					appointmentSource: AppointmentSource.UserApp,
					webhookSyncStatus: WebhookSyncStatus.Pending,
					appointmentMode: appointmentMode,
					...calFields,
				});
			} catch (err: any) {
				if (err.code === 11000) {
					res.status(409).json({
						error: "You already have a nutritionist booking.",
						code: "CONFLICT",
					});
					return;
				}
				throw err;
			}

			// Trigger background poll if the URL is a placeholder (e.g. integrations:google:meet)
			if (calFields.meetingUrl && !/^https?:\/\//i.test(calFields.meetingUrl)) {
				calidService.startBackgroundPollForMeetingUrl(appointment._id, calFields.calIdBookingId);
			}

			// 5. Advance onboarding step
			try {
				await advanceStep(req.user.id, OnboardingStep.NUTRITIONIST_BOOKING);
			} catch (error) {
				if (!(error instanceof OnboardingServiceError)) throw error;
			}

			// Helper to format slot time:
			const formatToTimeZoneTime = (
				isoString: string,
				timeZone: string,
			): string => {
				const d = new Date(isoString);
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone,
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				}).formatToParts(d);
				const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
				const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
				const hh = hour === "24" ? "00" : hour;
				return `${hh}:${minute}`;
			};

			const mappedBooking = {
				_id: appointment._id.toString(),
				bookingId: appointment._id.toString(),
				slotId: slotId,
				date:
					calFields.appointmentStart || appointment.appointmentStart || date,
				startTime: calFields.appointmentStart
					? formatToTimeZoneTime(
							calFields.appointmentStart.toISOString(),
							appointment.timezone,
						)
					: "",
				endTime: calFields.appointmentEnd
					? formatToTimeZoneTime(
							calFields.appointmentEnd.toISOString(),
							appointment.timezone,
						)
					: "",
				appointmentMode: appointmentMode,
				bookingStatus: "ACCEPTED",
				status: "ACCEPTED",
				meetingLink: appointment.meetingUrl || appointment.meetingLink,
			};

			res.status(201).json({
				message: "Nutritionist booking submitted for approval",
				booking: mappedBooking,
			});
			return;
		} catch (error) {
			next(error);
			return;
		}
	}

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
			bookingStatus: {
				$in: [
					NutritionistBookingStatus.PENDING,
					NutritionistBookingStatus.ACCEPTED,
				],
			},
		});

		if (existingActive) {
			const isPast = existingActive.date && new Date(existingActive.date).getTime() < Date.now() - 24 * 60 * 60 * 1000;
			if (!isPast) {
				res.status(409).json({
					error: "You already have a nutritionist booking.",
					code: "CONFLICT",
					bookingId: existingActive._id,
				});
				return;
			}
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

		let booking;
		try {
			booking = await NutritionistBooking.create({
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
		} catch (err: any) {
			if (err.code === 11000) {
				if (reservedSlotId) {
					await releaseSlotCapacity(reservedSlotId).catch(() => null);
				}
				res.status(409).json({
					error: "You already have a nutritionist booking.",
					code: "CONFLICT",
				});
				return;
			}
			throw err;
		}

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

		// 1. Slot-based bookings (NutritionistBooking collection)
		const slotBookings = await NutritionistBooking.find(filter)
			.populate("user", "username email phone")
			.populate("slot", "date startTime endTime capacity remainingCapacity")
			.sort({ createdAt: -1 });

		// Normalize slot bookings: rename `user` → `userId` for frontdesk compatibility
		const normalizedSlotBookings = slotBookings.map((b) => {
			const obj = b.toObject() as Record<string, unknown>;
			obj.userId = obj.user;
			delete obj.user;
			// Map date → appointmentDate
			if (!obj.appointmentDate && obj.date) {
				obj.appointmentDate = obj.date;
			}
			return obj;
		});

		// 2. Cal.id bookings (ExpertAppointment collection) — nutritionist type
		// Map ExpertAppointment statuses to the same shape as NutritionistBooking
		const calAppointmentFilter: Record<string, unknown> = {
			expertType: ExpertType.Nutritionist,
		};
		if (parsed.data.date) {
			const dayStart = normalizeToUtcDayStart(parsed.data.date);
			const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
			calAppointmentFilter.appointmentStart = { $gte: dayStart, $lt: dayEnd };
		}

		const calAppointments = await ExpertAppointment.find(calAppointmentFilter)
			.populate("userId", "username email phone")
			.sort({ createdAt: -1 })
			.lean();

		// Map ExpertAppointment status → NutritionistBooking-compatible status
		const statusMap: Record<string, string> = {
			Pending: "Pending",
			Confirmed: "Confirmed",
			Cancelled: "Cancelled",
			Completed: "Completed",
			Rescheduled: "Confirmed",
		};

		const normalizedCalBookings = calAppointments.map((appt) => ({
			_id: appt._id,
			userId: appt.userId,
			expertType: "nutritionist",
			bookingStatus: statusMap[appt.bookingStatus] ?? "Pending",
			appointmentDate: appt.appointmentStart ?? null,
			appointmentMode: appt.appointmentMode ?? "ONLINE",
			meetingLink: appt.meetingUrl || appt.meetingLink || null,
			calBookingId: appt.calIdBookingId ?? (appt as any).calComBookingId ?? null,
			createdAt: appt.createdAt,
			updatedAt: appt.updatedAt,
			// Mark as cal.id source so frontdesk knows it's an ExpertAppointment
			_source: "cal",
		}));

		// Merge: deduplicate by userId so users with both records don't appear twice.
		// Priority: ExpertAppointment (Cal.id) > NutritionistBooking when both exist.
		const calUserIds = new Set(
			normalizedCalBookings
				.map((b) => (b.userId as any)?._id?.toString() ?? b.userId?.toString())
				.filter(Boolean),
		);
		const dedupedSlotBookings = normalizedSlotBookings.filter((b) => {
			const uid = (b.userId as any)?._id?.toString() ?? (b.userId as any)?.toString();
			return !calUserIds.has(uid);
		});

		// Apply status filter to Cal.id bookings if provided
		let mergedBookings: unknown[] = [...normalizedCalBookings, ...dedupedSlotBookings];
		if (parsed.data.status) {
			mergedBookings = mergedBookings.filter(
				(b: any) =>
					String(b.bookingStatus ?? "").toLowerCase() ===
					String(parsed.data.status ?? "").toLowerCase(),
			);
		}

		// Sort merged list by createdAt desc
		mergedBookings.sort((a: any, b: any) => {
			const ta = new Date(a.createdAt ?? 0).getTime();
			const tb = new Date(b.createdAt ?? 0).getTime();
			return tb - ta;
		});

		res.status(200).json({ bookings: mergedBookings, total: mergedBookings.length });
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
		res.status(400).json({ error: "Invalid booking id", code: "BAD_REQUEST" });
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
		let booking = await NutritionistBooking.findById(id);

		if (!booking) {
			const appointment = await ExpertAppointment.findOne({ _id: id, expertType: ExpertType.Nutritionist });
			if (!appointment) {
				const userExists = await User.findById(id);
				if (userExists) {
					const placeholderSlotId = new mongoose.Types.ObjectId();
					booking = await NutritionistBooking.create({
						user: id,
						slot: placeholderSlotId,
						date: new Date(),
						startTime: "10:00",
						endTime: "10:30",
						appointmentMode: AppointmentMode.ONLINE,
						bookingStatus: NutritionistBookingStatus.PENDING,
						nutritionistApprovalStatus: NutritionistApprovalStatus.PENDING,
					});

					try {
						await advanceStep(id, OnboardingStep.NUTRITIONIST_BOOKING);
					} catch (e) {}
				} else {
					res.status(404).json({ error: "Booking or User not found", code: "NOT_FOUND" });
					return;
				}
			} else {
				if (appointment.bookingStatus !== AppointmentBookingStatus.Pending) {
					res.status(409).json({
						error: `Cannot accept booking in '${appointment.bookingStatus}' state`,
						code: "CONFLICT",
					});
					return;
				}

				const updatedAppt = await ExpertAppointment.findByIdAndUpdate(
					id,
					{
						$set: {
							bookingStatus: AppointmentBookingStatus.Confirmed,
							lastSyncedAt: new Date(),
						},
					},
					{ new: true },
				);

				res.status(200).json({
					message: "Expert nutritionist appointment accepted",
					booking: {
						_id: updatedAppt?._id.toString(),
						userId: updatedAppt?.userId,
						expertType: "nutritionist",
						bookingStatus: "Confirmed",
						appointmentDate: updatedAppt?.appointmentStart,
						createdAt: updatedAppt?.createdAt,
					},
				});
				return;
			}
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

		if (parsed.data.meetingLink) {
			update.meetingLink = parsed.data.meetingLink;
		} else if (booking.appointmentMode === "ONLINE") {
			// Generate a real Google Meet link via Calendar API
			try {
				const { createGoogleMeetLink } = await import("../integrations/google/google-meet.service");
				const bookingDate = booking.date ? new Date(booking.date) : new Date();
				const startStr = booking.startTime || "10:00";
				const endStr = booking.endTime || "10:30";

				const buildIsoWithTimezone = (d: Date, tStr: string): string => {
					const y = d.getUTCFullYear();
					const m = String(d.getUTCMonth() + 1).padStart(2, "0");
					const dayStr = String(d.getUTCDate()).padStart(2, "0");
					const [h, min] = tStr.split(":");
					const hours = h ?? "10";
					const minutes = min ?? "00";
					return `${y}-${m}-${dayStr}T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:00+05:30`;
				};

				const startTime = buildIsoWithTimezone(bookingDate, startStr);
				const endTime = buildIsoWithTimezone(bookingDate, endStr);

				const meetUrl = await createGoogleMeetLink({
					summary: "Fitflix Nutritionist Consultation",
					startTime,
					endTime,
					timezone: "Asia/Kolkata",
				});

				if (meetUrl) {
					update.meetingLink = meetUrl;
					console.log(`[acceptNutritionistBooking] Created Google Meet: ${meetUrl}`);
				} else {
					console.warn(`[acceptNutritionistBooking] Google Meet API returned null for booking ${booking._id}`);
				}
			} catch (meetErr) {
				console.error(`[acceptNutritionistBooking] Google Meet creation failed for booking ${booking._id}:`, meetErr);
			}
		}

		if (parsed.data.clinicLocation)
			update.clinicLocation = parsed.data.clinicLocation;
		if (parsed.data.calBookingId)
			update.calBookingId = parsed.data.calBookingId;

		const updated = await NutritionistBooking.findOneAndUpdate(
			{ _id: booking._id, bookingStatus: NutritionistBookingStatus.PENDING },
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
		res.status(400).json({ error: "Invalid booking id", code: "BAD_REQUEST" });
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
		let booking = await NutritionistBooking.findById(id);

		if (!booking) {
			const appointment = await ExpertAppointment.findOne({ _id: id, expertType: ExpertType.Nutritionist });
			if (!appointment) {
				res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
				return;
			}

			if (
				appointment.bookingStatus === AppointmentBookingStatus.Cancelled ||
				appointment.bookingStatus === AppointmentBookingStatus.Completed
			) {
				res.status(409).json({
					error: `Cannot reject booking in '${appointment.bookingStatus}' state`,
					code: "CONFLICT",
				});
				return;
			}

			const updatedAppt = await ExpertAppointment.findByIdAndUpdate(
				id,
				{
					$set: {
						bookingStatus: AppointmentBookingStatus.Cancelled,
						lastSyncedAt: new Date(),
					},
				},
				{ new: true },
			);

			res.status(200).json({
				message: "Expert nutritionist appointment rejected",
				booking: {
					_id: updatedAppt?._id.toString(),
					userId: updatedAppt?.userId,
					expertType: "nutritionist",
					bookingStatus: "Cancelled",
					appointmentDate: updatedAppt?.appointmentStart,
					createdAt: updatedAppt?.createdAt,
				},
			});
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
				.populate("slot", "date startTime endTime capacity remainingCapacity")
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

export const completeNutritionistBooking: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({
			error: "Only admins/frontdesk can complete nutritionist bookings",
			code: "FORBIDDEN",
		});
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid booking id", code: "BAD_REQUEST" });
		return;
	}

	try {
		let booking = await NutritionistBooking.findById(id);

		if (!booking) {
			const appointment = await ExpertAppointment.findOne({ _id: id, expertType: ExpertType.Nutritionist });
			if (!appointment) {
				res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
				return;
			}

			if (appointment.bookingStatus === AppointmentBookingStatus.Completed) {
				res.status(200).json({
					message: "Expert nutritionist appointment already completed",
					booking: {
						_id: appointment._id.toString(),
						userId: appointment.userId,
						expertType: "nutritionist",
						bookingStatus: "Completed",
						appointmentDate: appointment.appointmentStart,
						createdAt: appointment.createdAt,
					},
				});
				return;
			}

			const updatedAppt = await ExpertAppointment.findByIdAndUpdate(
				id,
				{
					$set: {
						bookingStatus: AppointmentBookingStatus.Completed,
						lastSyncedAt: new Date(),
					},
				},
				{ new: true },
			);

			res.status(200).json({
				message: "Expert nutritionist appointment completed",
				booking: {
					_id: updatedAppt?._id.toString(),
					userId: updatedAppt?.userId,
					expertType: "nutritionist",
					bookingStatus: "Completed",
					appointmentDate: updatedAppt?.appointmentStart,
					createdAt: updatedAppt?.createdAt,
				},
			});
			return;
		}

		if (booking.bookingStatus === NutritionistBookingStatus.COMPLETED) {
			res.status(200).json({
				message: "Booking is already completed",
				booking,
			});
			return;
		}

		const updated = await NutritionistBooking.findByIdAndUpdate(
			id,
			{
				$set: {
					bookingStatus: NutritionistBookingStatus.COMPLETED,
					completedAt: new Date(),
				},
			},
			{ new: true },
		);

		res.status(200).json({
			message: "Nutritionist booking completed",
			booking: updated,
		});
	} catch (error) {
		next(error);
	}
};

export const switchToOnlineMeeting: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({
			error: "Only users can change their own booking mode",
			code: "FORBIDDEN",
		});
		return;
	}

	const userId = new mongoose.Types.ObjectId(req.user.id);

	try {
		// 1. Try finding an active ExpertAppointment (Cal.id/Onboarding slots)
		const appointment = await ExpertAppointment.findOne({
			userId,
			expertType: ExpertType.Nutritionist,
			bookingStatus: {
				$in: [
					AppointmentBookingStatus.Pending,
					AppointmentBookingStatus.Confirmed,
					AppointmentBookingStatus.Rescheduled,
				],
			},
		});

		if (appointment) {
			const appointmentStart = appointment.appointmentStart || appointment.appointmentDate;
			if (!appointmentStart) {
				res.status(400).json({
					error: "No scheduled date/time found for your appointment.",
					code: "BAD_REQUEST",
				});
				return;
			}

			const diff = appointmentStart.getTime() - Date.now();
			if (diff < 1 * 60 * 60 * 1000) {
				res.status(400).json({
					error: "Cannot change appointment mode within 1 hour of the scheduled time.",
					code: "TOO_LATE",
				});
				return;
			}

			if (appointment.appointmentMode === AppointmentMode.ONLINE) {
				res.status(200).json({
					message: "Appointment is already online",
					appointment,
				});
				return;
			}

			appointment.appointmentMode = AppointmentMode.ONLINE;

			// Generate Google Meet link if not present
			if (!appointment.meetingUrl && !appointment.meetingLink) {
				try {
					const { createGoogleMeetLink } = await import(
						"../integrations/google/google-meet.service"
					);
					const startIso = appointmentStart.toISOString();
					const endIso = new Date(
						appointmentStart.getTime() + 30 * 60 * 1000,
					).toISOString();
					const meetUrl = await createGoogleMeetLink({
						summary: "Fitflix Nutritionist Consultation",
						startTime: startIso,
						endTime: endIso,
						timezone: "Asia/Kolkata",
					});
					if (meetUrl) {
						appointment.meetingUrl = meetUrl;
						appointment.meetingLink = meetUrl;
					}
				} catch (err) {
					console.error("[switchToOnline] Google Meet creation failed:", err);
				}
			}

			await appointment.save();

			res.status(200).json({
				message: "Appointment switched to online successfully",
				appointment,
			});
			return;
		}

		// 2. Try finding a NutritionistBooking (slot-based)
		const booking = await NutritionistBooking.findOne({
			user: userId,
			bookingStatus: {
				$in: [
					NutritionistBookingStatus.PENDING,
					NutritionistBookingStatus.ACCEPTED,
				],
			},
		});

		if (booking) {
			const bookingDate = booking.date;
			if (!bookingDate) {
				res.status(400).json({
					error: "No scheduled date found for your booking.",
					code: "BAD_REQUEST",
				});
				return;
			}

			const y = bookingDate.getUTCFullYear();
			const m = bookingDate.getUTCMonth();
			const d = bookingDate.getUTCDate();
			const [hStr, minStr] = (booking.startTime || "10:00").split(":");
			const hours = parseInt(hStr ?? "10", 10);
			const minutes = parseInt(minStr ?? "00", 10);
			// Slot times are scheduled in +05:30 local timezone (India)
			const appointmentStart = new Date(
				Date.UTC(y, m, d, hours, minutes) - 5.5 * 60 * 60 * 1000,
			);

			const diff = appointmentStart.getTime() - Date.now();
			if (diff < 1 * 60 * 60 * 1000) {
				res.status(400).json({
					error: "Cannot change appointment mode within 1 hour of the scheduled time.",
					code: "TOO_LATE",
				});
				return;
			}

			if (booking.appointmentMode === AppointmentMode.ONLINE) {
				res.status(200).json({
					message: "Booking is already online",
					booking,
				});
				return;
			}

			let meetingLink: string | undefined = booking.meetingLink ?? undefined;

			// Generate Google Meet link if not present
			if (!meetingLink) {
				try {
					const { createGoogleMeetLink } = await import(
						"../integrations/google/google-meet.service"
					);
					const startIso = appointmentStart.toISOString();
					const endIso = new Date(
						appointmentStart.getTime() + 30 * 60 * 1000,
					).toISOString();
					const meetUrl = await createGoogleMeetLink({
						summary: "Fitflix Nutritionist Consultation",
						startTime: startIso,
						endTime: endIso,
						timezone: "Asia/Kolkata",
					});
					if (meetUrl) {
						meetingLink = meetUrl;
					}
				} catch (err) {
					console.error("[switchToOnline] Google Meet creation failed:", err);
				}
			}

			const updatedBooking = await NutritionistBooking.findByIdAndUpdate(
				booking._id,
				{
					$set: {
						appointmentMode: AppointmentMode.ONLINE,
						meetingLink,
					},
				},
				{ new: true },
			);

			res.status(200).json({
				message: "Booking switched to online successfully",
				booking: updatedBooking,
			});
			return;
		}

		res.status(404).json({
			error: "No active nutritionist booking found",
			code: "NOT_FOUND",
		});
	} catch (error) {
		next(error);
	}
};
