import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { AppointmentMode, ExpertType, MeetingStatus, NutritionistBookingStatus, OnboardingStep } from "../models/Enums";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import {
	releaseSlotCapacity,
	reserveSlotCapacity,
	resolveConcreteSlotForBooking,
} from "../services/slot-reservation.service";
import User from "../models/User";
import { advanceStep, getOnboardingStatus } from "../utils/onboarding.service";
import { combineSessionDateTime, NUTRI_CANCEL_WINDOW_MINUTES } from "../utils/zego-room";
import {
	acceptNutritionistBookingSchema,
	bookNutritionistSchema,
	cancelNutritionistBookingSchema,
	rescheduleNutritionistBookingSchema,
	switchToOnlineSchema,
} from "../validators/nutritionist-booking.validator";

// Mirrors bookSportsScientist's expertType guard on the sports-scientist side
// (onboarding.controller.ts), so a nutritionist booking can no longer reserve
// a sports-scientist slot found by bare id. `null` is included because slots
// created before `expertType` existed carry no such field at all and were
// always nutritionist inventory — see the matching comment in
// slot.controller.ts's getAvailableSlots.
const NUTRITIONIST_SLOT_FILTER = { $in: [ExpertType.Nutritionist, null] };

export const bookNutritionist: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = bookNutritionistSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const {
			slotId,
			date,
			startTime: reqStartTime,
			endTime: reqEndTime,
			appointmentMode,
			clinicLocation,
			notes,
		} = parsed.data;

		let startTime = reqStartTime ?? "10:00";
		let endTime = reqEndTime ?? "10:30";
		let resolvedSlotId: mongoose.Types.ObjectId | null = null;

		const bookingDate = new Date(date);

		if (slotId && mongoose.Types.ObjectId.isValid(slotId)) {
			// Scoped to nutritionist inventory — bookSportsScientist applies the
			// mirror-image guard on its side, so nutritionist and sports-scientist
			// bookings can no longer draw from each other's slot ids.
			const slot = await Slot.findOne({
				_id: new mongoose.Types.ObjectId(slotId),
				expertType: NUTRITIONIST_SLOT_FILTER,
			});
			if (slot) {
				// `slotId` is usually a *daily template* — a slot with no date that
				// stands for "this window, every day". Reserving against the template
				// itself drains it globally and permanently, so the window dies for
				// every future date once its capacity is spent. Materialize the
				// per-date child instead, exactly as the therapy flow does, and book
				// that. The template is left untouched and resets naturally each day.
				const concreteSlot = await resolveConcreteSlotForBooking(
					slot,
					bookingDate,
				);

				if (!concreteSlot) {
					res.status(400).json({
						error: "Selected slot is not available on that date",
						code: "SLOT_UNAVAILABLE",
					});
					return;
				}

				const reservedSlot = await reserveSlotCapacity(
					concreteSlot._id.toString(),
				);

				if (!reservedSlot) {
					res.status(400).json({
						error: "Selected slot is fully booked",
						code: "SLOT_FULL",
					});
					return;
				}

				// The booking must point at the concrete child, not the template —
				// the release paths (reject / expire / reschedule) $inc this id back.
				resolvedSlotId = concreteSlot._id;
				startTime = concreteSlot.startTime;
				endTime = concreteSlot.endTime;
			}
		}

		const booking = new NutritionistBooking({
			userId: new mongoose.Types.ObjectId(user.id),
			slotId: resolvedSlotId,
			bookingDate,
			startTime,
			endTime,
			appointmentMode: appointmentMode ?? AppointmentMode.ONLINE,
			clinicLocation: clinicLocation ?? null,
			notes: notes ?? null,
			meetingStatus: MeetingStatus.SCHEDULED,
			status: NutritionistBookingStatus.PENDING,
		});

		// Auto-generate zegoRoomId for ONLINE mode
		if (booking.appointmentMode === AppointmentMode.ONLINE) {
			booking.zegoRoomId = `nutri_session_${booking._id.toString()}`;
		}

		await booking.save();

		// Check onboarding status and advance if applicable
		try {
			const onboardingStatus = await getOnboardingStatus(user.id);
			if (!onboardingStatus.onboardingCompleted) {
				await User.findByIdAndUpdate(user.id, {
					$set: { "onboardingStatus.nutritionistBooked": true },
				});
				// SPORT_SCIENTIST_APPOINTMENT belongs here too: it was inserted
				// into STEP_ORDER between REPORT_UPLOAD and NUTRITIONIST_BOOKING
				// after this condition was written, so a member parked on the
				// sports-scientist step who books a nutritionist used to get
				// `nutritionistBooked: true` while `currentStep` stayed on step 5
				// forever — which drops them back onto the sports-scientist page
				// every time they land on /onboarding.
				if (
					onboardingStatus.currentStep === OnboardingStep.REPORT_UPLOAD ||
					onboardingStatus.currentStep ===
						OnboardingStep.SPORT_SCIENTIST_APPOINTMENT ||
					onboardingStatus.currentStep === OnboardingStep.NUTRITIONIST_BOOKING
				) {
					await advanceStep(user.id, OnboardingStep.NUTRITIONIST_BOOKING);
				}
			}
		} catch (_err) {
			// Non-onboarding user or post-onboarding user — ignore error
		}

		res.status(201).json({
			message: "Nutritionist booking submitted successfully",
			booking,
		});
	} catch (error) {
		next(error);
	}
};

export const getMemberBooking: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const booking = await NutritionistBooking.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: { $ne: NutritionistBookingStatus.REJECTED },
		})
			.sort({ createdAt: -1 })
			.lean();

		if (!booking) {
			res.status(404).json({
				error: "No active nutritionist booking found",
				code: "NOT_FOUND",
				booking: null,
			});
			return;
		}

		res.status(200).json({ booking });
	} catch (error) {
		next(error);
	}
};

export const getAllBookingsForAdmin: RequestHandler = async (req, res, next) => {
	try {
		const { status } = req.query;
		const query: Record<string, unknown> = {};

		if (typeof status === "string" && status) {
			const allowed = Object.values(NutritionistBookingStatus) as string[];
			const requested = status.toUpperCase();
			if (!allowed.includes(requested)) {
				res.status(400).json({
					error: "Invalid status filter",
					code: "BAD_REQUEST",
				});
				return;
			}
			query.status = requested;
		}

		const bookings = await NutritionistBooking.find(query)
			.populate("userId", "username email phone")
			.sort({ createdAt: -1 })
			.lean();

		res.status(200).json({ bookings });
	} catch (error) {
		next(error);
	}
};

export const getMyBookings: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const bookings = await NutritionistBooking.find({
			userId: new mongoose.Types.ObjectId(user.id),
		})
			.sort({ createdAt: -1 })
			.lean();

		res.status(200).json({ bookings });
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

		const parsed = acceptNutritionistBookingSchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const { clinicLocation, assignedNutritionistId, assignedNutritionistName } = parsed.data;

		const booking = await NutritionistBooking.findById(id);
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		// Re-validate the linked slot before accepting. Between booking time
		// and admin action, an admin might have deleted/retired the slot, or
		// the slot's appointment time may have already passed.
		const now = new Date();

		if (!booking.slotId && !booking.bookingDate) {
			booking.status = NutritionistBookingStatus.RESCHEDULE_REQUIRED;
			await booking.save();
			res.status(409).json({
				error: "No slot selected for this booking. The user has been asked to pick a time slot.",
				code: "SLOT_REQUIRED",
				booking,
			});
			return;
		}

		let appointmentDate = booking.bookingDate;
		let endTimeStr = booking.endTime;

		if (booking.slotId) {
			const slot = await Slot.findById(booking.slotId).lean();
			if (!slot || slot.capacity <= 0) {
				booking.status = NutritionistBookingStatus.RESCHEDULE_REQUIRED;
				await booking.save();
				res.status(409).json({
					error:
						"Original slot is no longer available. The user has been asked to pick a new time.",
					code: "SLOT_NO_LONGER_AVAILABLE",
					booking,
				});
				return;
			}
			appointmentDate = slot.date || booking.bookingDate;
			endTimeStr = slot.endTime || booking.endTime;
		}

		// Validate that the slot date/time has not already passed
		if (appointmentDate && endTimeStr) {
			const appointmentEndInstant = combineSessionDateTime(appointmentDate, endTimeStr);
			if (appointmentEndInstant && appointmentEndInstant.getTime() < now.getTime()) {
				booking.status = NutritionistBookingStatus.RESCHEDULE_REQUIRED;
				await booking.save();
				res.status(409).json({
					error:
						"This appointment slot date/time has already passed. The user has been asked to pick a new time.",
					code: "SLOT_EXPIRED_RESCHEDULE_REQUIRED",
					booking,
				});
				return;
			}
		}

		let nutritionistName = assignedNutritionistName ?? null;
		let nutritionistIdObj: mongoose.Types.ObjectId | null = null;

		if (assignedNutritionistId && mongoose.Types.ObjectId.isValid(assignedNutritionistId)) {
			nutritionistIdObj = new mongoose.Types.ObjectId(assignedNutritionistId);
			if (!nutritionistName) {
				const nutUser = await User.findById(nutritionistIdObj).select("username");
				if (nutUser) {
					nutritionistName = nutUser.username;
				}
			}
		}

		booking.status = NutritionistBookingStatus.ACCEPTED;
		booking.acceptedAt = new Date();

		if (clinicLocation) {
			booking.clinicLocation = clinicLocation;
		}

		if (nutritionistIdObj) {
			booking.assignedNutritionistId = nutritionistIdObj;
		}

		if (nutritionistName) {
			booking.assignedNutritionistName = nutritionistName;
		}

		// Ensure zegoRoomId exists for ONLINE mode
		if (booking.appointmentMode === AppointmentMode.ONLINE && !booking.zegoRoomId) {
			booking.zegoRoomId = `nutri_session_${booking._id.toString()}`;
		}

		await booking.save();

		res.status(200).json({
			message: "Nutritionist booking accepted",
			booking,
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

		const booking = await NutritionistBooking.findById(id);
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.status === NutritionistBookingStatus.REJECTED ||
			booking.status === NutritionistBookingStatus.COMPLETED
		) {
			res.status(400).json({
				error: `Booking is already ${booking.status.toLowerCase()} and cannot be rejected`,
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		// Release the slot capacity that bookNutritionist reserved, mirroring
		// the atomic decrement performed at creation time.
		if (booking.slotId) {
			await releaseSlotCapacity(booking.slotId.toString());
		}

		booking.status = NutritionistBookingStatus.REJECTED;
		await booking.save();

		res.status(200).json({
			message: "Nutritionist booking rejected",
			booking,
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

		const booking = await NutritionistBooking.findById(id);
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (booking.status !== NutritionistBookingStatus.ACCEPTED) {
			res.status(400).json({
				error: "Only an accepted booking can be marked completed",
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		booking.status = NutritionistBookingStatus.COMPLETED;
		booking.meetingStatus = MeetingStatus.COMPLETED;
		booking.completedAt = new Date();
		await booking.save();

		res.status(200).json({
			message: "Nutritionist consultation marked complete",
			booking,
		});
	} catch (error) {
		next(error);
	}
};

export const rescheduleMyBooking: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = rescheduleNutritionistBookingSchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const { slotId, date, appointmentMode } = parsed.data;

		if (!mongoose.Types.ObjectId.isValid(slotId)) {
			res.status(400).json({ error: "Invalid slotId", code: "BAD_REQUEST" });
			return;
		}

		// A healthy PENDING/ACCEPTED booking may now self-reschedule too, not
		// just one staff already bounced into RESCHEDULE_REQUIRED.
		const booking = await NutritionistBooking.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: {
				$in: [
					NutritionistBookingStatus.PENDING,
					NutritionistBookingStatus.ACCEPTED,
					NutritionistBookingStatus.RESCHEDULE_REQUIRED,
				],
			},
		}).sort({ createdAt: -1 });

		if (!booking) {
			res.status(404).json({
				error: "No active nutritionist booking was found",
				code: "NOT_FOUND",
			});
			return;
		}

		// The cutoff only applies to a booking the member hasn't already been
		// bounced out of — RESCHEDULE_REQUIRED was staff's doing, and must stay
		// reschedulable at any time.
		if (
			booking.status === NutritionistBookingStatus.PENDING ||
			booking.status === NutritionistBookingStatus.ACCEPTED
		) {
			const startsAt = combineSessionDateTime(booking.bookingDate, booking.startTime);
			if (
				startsAt &&
				startsAt.getTime() - Date.now() < NUTRI_CANCEL_WINDOW_MINUTES * 60_000
			) {
				res.status(409).json({
					error: "This appointment starts too soon to reschedule yourself — please contact the front desk",
					code: "RESCHEDULE_WINDOW_CLOSED",
				});
				return;
			}
		}

		// The date the rescheduled appointment lands on — needed before reserving,
		// since capacity is now held per date rather than on the template.
		let rescheduledDate = booking.bookingDate;
		if (date) {
			const parsedDate = new Date(date);
			if (!Number.isNaN(parsedDate.getTime())) {
				rescheduledDate = parsedDate;
			}
		}

		// Scoped to nutritionist inventory for the same reason as bookNutritionist
		// above — a reschedule must not be able to reserve a sports-scientist slot.
		const requestedSlot = await Slot.findOne({
			_id: new mongoose.Types.ObjectId(slotId),
			expertType: NUTRITIONIST_SLOT_FILTER,
		});

		if (!requestedSlot) {
			res.status(409).json({
				error: "Selected slot is fully booked or does not exist",
				code: "SLOT_FULL",
			});
			return;
		}

		// Same template→concrete resolution as bookNutritionist: reserve the
		// per-date child so the template's capacity survives the reschedule.
		const newSlot = await resolveConcreteSlotForBooking(
			requestedSlot,
			rescheduledDate,
		);

		if (!newSlot) {
			res.status(409).json({
				error: "Selected slot is not available on that date",
				code: "SLOT_UNAVAILABLE",
			});
			return;
		}

		// Atomically reserve the new slot before touching the booking, so a
		// failed reservation leaves everything unchanged.
		const newSlotId = newSlot._id;
		const reservedSlot = await reserveSlotCapacity(newSlotId.toString());

		if (!reservedSlot) {
			res.status(409).json({
				error: "Selected slot is fully booked or does not exist",
				code: "SLOT_FULL",
			});
			return;
		}

		const oldSlotId = booking.slotId;

		booking.slotId = newSlotId;
		booking.startTime = reservedSlot.startTime;
		booking.endTime = reservedSlot.endTime;
		booking.bookingDate = rescheduledDate;
		booking.status = NutritionistBookingStatus.PENDING;
		booking.acceptedAt = null;
		if (appointmentMode) {
			booking.appointmentMode = appointmentMode;
			if (appointmentMode === AppointmentMode.ONLINE && !booking.zegoRoomId) {
				booking.zegoRoomId = `nutri_session_${booking._id.toString()}`;
			}
		}
		await booking.save();

		// Release the old slot last, wrapped so a release failure doesn't hide
		// the successful reservation + booking update above.
		if (oldSlotId) {
			try {
				await releaseSlotCapacity(oldSlotId.toString());
			} catch (err) {
				console.error(
					`[nutritionist-reschedule] Old slot release failed for booking ${String(booking._id)}`,
					err,
				);
			}
		}

		res.status(200).json({
			message: "Booking rescheduled — awaiting admin acceptance",
			booking,
		});
	} catch (error) {
		next(error);
	}
};

export const switchToOnline: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = switchToOnlineSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		const booking = await NutritionistBooking.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: { $ne: NutritionistBookingStatus.REJECTED },
		}).sort({ createdAt: -1 });

		if (!booking) {
			res.status(404).json({
				error: "No active nutritionist booking found to switch to online mode",
				code: "NOT_FOUND",
			});
			return;
		}

		booking.appointmentMode = AppointmentMode.ONLINE;
		if (!booking.zegoRoomId) {
			booking.zegoRoomId = `nutri_session_${booking._id.toString()}`;
		}

		if (parsed.data.notes) {
			booking.notes = parsed.data.notes;
		}

		await booking.save();

		res.status(200).json({
			message: "Switched to online mode successfully",
			booking,
		});
	} catch (error) {
		next(error);
	}
};

export const cancelMyBooking: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user || !user.id) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = cancelNutritionistBookingSchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation error",
				code: "BAD_REQUEST",
				details: parsed.error.format(),
			});
			return;
		}

		// A booking already REJECTED/CANCELLED/COMPLETED/EXPIRED has nothing left
		// to cancel; RESCHEDULE_REQUIRED is included since it's still an active
		// request the member may simply want to withdraw.
		const booking = await NutritionistBooking.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: {
				$in: [
					NutritionistBookingStatus.PENDING,
					NutritionistBookingStatus.ACCEPTED,
					NutritionistBookingStatus.RESCHEDULE_REQUIRED,
				],
			},
		}).sort({ createdAt: -1 });

		if (!booking) {
			res.status(404).json({
				error: "No active nutritionist booking was found",
				code: "NOT_FOUND",
			});
			return;
		}

		// Unlike the reschedule cutoff, cancellation is blocked close to start
		// regardless of status — RESCHEDULE_REQUIRED included, since staff would
		// otherwise lose visibility into a booking the member intends to drop
		// right before it would have needed a decision.
		const startsAt = combineSessionDateTime(booking.bookingDate, booking.startTime);
		if (
			startsAt &&
			startsAt.getTime() - Date.now() < NUTRI_CANCEL_WINDOW_MINUTES * 60_000
		) {
			res.status(409).json({
				error: "This appointment starts too soon to cancel yourself — please contact the front desk",
				code: "CANCELLATION_WINDOW_CLOSED",
			});
			return;
		}

		// Release the slot capacity reserved at booking/reschedule time, mirroring
		// rejectBooking. meetingStatus is left alone — the meeting was scheduled,
		// never held; that's a fact about the session, not the booking's outcome.
		if (booking.slotId) {
			await releaseSlotCapacity(booking.slotId.toString());
		}

		booking.status = NutritionistBookingStatus.CANCELLED;
		booking.cancelledAt = new Date();
		booking.cancelledBy = "user";
		booking.cancellationReason = parsed.data.reason ?? null;
		await booking.save();

		res.status(200).json({
			message: "Nutritionist booking cancelled",
			booking,
		});
	} catch (error) {
		next(error);
	}
};
