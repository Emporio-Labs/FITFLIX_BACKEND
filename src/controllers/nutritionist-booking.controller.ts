import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	AppointmentMode,
	ExpertType,
	MeetingStatus,
	OnboardingStep,
	UnifiedBookingStatus,
} from "../models/Enums";
import Slot from "../models/Slots";
import UnifiedBooking from "../models/UnifiedBooking";
import User from "../models/User";
import { pickExpertForSlot } from "../services/expert-schedule.service";
import {
	releaseSlotCapacity,
	reserveSlotCapacity,
	resolveConcreteSlotForBooking,
} from "../services/slot-reservation.service";
import { normalizeAppointmentModeOr } from "../utils/appointment-mode";
import {
	ACTIVE_NUTRITIONIST_STATUSES,
	fromLegacyNutritionistStatus,
	NUTRITIONIST_BOOKING_FILTER,
	serializeNutritionistBooking,
} from "../utils/nutritionist-booking.dto";
import { advanceStep, getOnboardingStatus } from "../utils/onboarding.service";
import {
	combineSessionDateTime,
	NUTRI_CANCEL_WINDOW_MINUTES,
} from "../utils/zego-room";
import {
	acceptNutritionistBookingSchema,
	bookNutritionistSchema,
	cancelNutritionistBookingSchema,
	rescheduleNutritionistBookingSchema,
	switchToOnlineSchema,
} from "../validators/nutritionist-booking.validator";

/**
 * Nutrition consultations now live in `UnifiedBooking` alongside personal
 * training — see utils/nutritionist-booking.dto.ts for why the wire format is
 * unchanged.
 *
 * The important behavioural change is that the expert is bound *at creation*
 * from `ExpertSchedule` availability rather than assigned afterwards by an
 * admin. That is what makes double-booking impossible: the losing candidates
 * were never free, and UnifiedBooking's partial unique index on
 * `{expertId, bookingDate, startTime}` catches the concurrent case.
 *
 * The legacy `Slot` path is still honoured when the client sends a `slotId`,
 * because the deployed member app books that way until it is pointed at pooled
 * availability. Slot rows for 1:1 experts are retired once that ships.
 */

// Mirrors bookSportsScientist's expertType guard on the sports-scientist side
// (onboarding.controller.ts), so a nutritionist booking can no longer reserve
// a sports-scientist slot found by bare id. `null` is included because slots
// created before `expertType` existed carry no such field at all and were
// always nutritionist inventory — see the matching comment in
// slot.controller.ts's getAvailableSlots.
const NUTRITIONIST_SLOT_FILTER = { $in: [ExpertType.Nutritionist, null] };

const roomIdFor = (bookingId: mongoose.Types.ObjectId | string) =>
	`nutri_session_${String(bookingId)}`;

const findMemberBooking = (
	userId: string,
	statuses: UnifiedBookingStatus[],
) =>
	UnifiedBooking.findOne({
		...NUTRITIONIST_BOOKING_FILTER,
		userId: new mongoose.Types.ObjectId(userId),
		status: { $in: statuses },
	}).sort({ createdAt: -1 });

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

		const mode = normalizeAppointmentModeOr(
			appointmentMode,
			AppointmentMode.ONLINE,
		);

		let startTime = reqStartTime ?? "10:00";
		let endTime = reqEndTime ?? "10:30";
		let resolvedSlotId: mongoose.Types.ObjectId | null = null;

		const bookingDate = new Date(date);

		if (slotId && mongoose.Types.ObjectId.isValid(slotId)) {
			// ── Legacy Slot path ────────────────────────────────────────────────
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

		// ── Bind an expert at creation ────────────────────────────────────────
		// Returns null when nobody of that type is free then — which is the normal
		// outcome for a legacy slot time that doesn't line up with anyone's
		// generated grid. The booking is still accepted unassigned in that case,
		// exactly as before, and staff assign at accept time.
		const assignment = await pickExpertForSlot({
			expertType: ExpertType.Nutritionist,
			date: bookingDate,
			startTime,
			mode,
		});

		if (assignment) {
			endTime = assignment.endTime;
		}

		const booking = new UnifiedBooking({
			...NUTRITIONIST_BOOKING_FILTER,
			userId: new mongoose.Types.ObjectId(user.id),
			slotId: resolvedSlotId,
			bookingDate,
			startTime,
			endTime,
			appointmentMode: mode,
			location: clinicLocation ?? (mode === AppointmentMode.ONLINE ? "Online Video Room" : null),
			memberNotes: notes ?? null,
			meetingStatus: MeetingStatus.SCHEDULED,
			status: UnifiedBookingStatus.PENDING,
			expertId: assignment?.expertId ?? null,
			expertModel: assignment?.expertModel ?? "User",
			assignedExpertName: assignment?.expertName ?? "",
			// A consultation is not a PT session drawn from a package quota.
			consumptionModel: "CREDIT_POOL",
			creditCostSnapshot: 0,
			creditsBypassed: true,
		});

		// Auto-generate zegoRoomId for ONLINE mode
		if (booking.appointmentMode === AppointmentMode.ONLINE) {
			booking.zegoRoomId = roomIdFor(booking._id);
		}

		try {
			await booking.save();
		} catch (err) {
			// The partial unique index on {expertId, bookingDate, startTime} fired:
			// somebody else took this expert's slot between the availability read
			// and this write. That is the race the index exists to catch.
			if ((err as { code?: number }).code === 11000) {
				if (resolvedSlotId) {
					await releaseSlotCapacity(resolvedSlotId.toString()).catch(() => {});
				}
				res.status(409).json({
					error: "That time was just taken. Please pick another.",
					code: "SLOT_CONFLICT",
				});
				return;
			}
			throw err;
		}

		// Check onboarding status and advance if applicable. Unconditional now —
		// this used to only call advanceStep when currentStep was one of three
		// specific values, which meant a real booking made after a skip-all
		// (currentStep already latched to COMPLETED) got `nutritionistBooked:
		// true` but stayed recorded in `skippedSteps` and never entered
		// `completedSteps`. advanceStep is monotonic (onboarding.service.ts's
		// isForwardMove only ever moves currentStep forward), so calling it here
		// regardless of currentStep cannot rewind an already-finished member —
		// it can only do the completedSteps/skippedSteps bookkeeping this branch
		// exists for.
		try {
			const onboardingStatus = await getOnboardingStatus(user.id);
			if (!onboardingStatus.onboardingCompleted) {
				await User.findByIdAndUpdate(user.id, {
					$set: { "onboardingStatus.nutritionistBooked": true },
				});
				await advanceStep(user.id, OnboardingStep.NUTRITIONIST_BOOKING);
			}
		} catch (err) {
			// Non-onboarding user or post-onboarding user is routine and falls
			// through here too (advanceStep/getOnboardingStatus throw NOT_FOUND-
			// shaped errors for those), but a genuine failure must not vanish
			// silently behind the 201 below.
			console.error(
				"bookNutritionist: failed to advance onboarding status",
				err,
			);
		}

		res.status(201).json({
			message: "Nutritionist booking submitted successfully",
			booking: serializeNutritionistBooking(booking),
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

		const booking = await UnifiedBooking.findOne({
			...NUTRITIONIST_BOOKING_FILTER,
			userId: new mongoose.Types.ObjectId(user.id),
			status: { $ne: UnifiedBookingStatus.REJECTED },
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

		res.status(200).json({ booking: serializeNutritionistBooking(booking) });
	} catch (error) {
		next(error);
	}
};

export const getAllBookingsForAdmin: RequestHandler = async (req, res, next) => {
	try {
		const { status } = req.query;
		const query: Record<string, unknown> = { ...NUTRITIONIST_BOOKING_FILTER };

		if (typeof status === "string" && status) {
			// Filters still arrive in the legacy vocabulary ("ACCEPTED"), so they
			// are translated rather than matched against stored values directly.
			const mapped = fromLegacyNutritionistStatus(status);
			if (!mapped) {
				res.status(400).json({
					error: "Invalid status filter",
					code: "BAD_REQUEST",
				});
				return;
			}
			query.status = mapped;
		}

		const bookings = await UnifiedBooking.find(query)
			.populate("userId", "username email phone")
			.sort({ createdAt: -1 })
			.lean();

		res
			.status(200)
			.json({ bookings: bookings.map(serializeNutritionistBooking) });
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

		const bookings = await UnifiedBooking.find({
			...NUTRITIONIST_BOOKING_FILTER,
			userId: new mongoose.Types.ObjectId(user.id),
		})
			.sort({ createdAt: -1 })
			.lean();

		res
			.status(200)
			.json({ bookings: bookings.map(serializeNutritionistBooking) });
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

		const { clinicLocation, assignedNutritionistId, assignedNutritionistName } =
			parsed.data;

		const booking = await UnifiedBooking.findOne({
			_id: id,
			...NUTRITIONIST_BOOKING_FILTER,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		// Re-validate the linked slot before accepting. Between booking time
		// and admin action, an admin might have deleted/retired the slot, or
		// the slot's appointment time may have already passed.
		const now = new Date();

		if (!booking.slotId && !booking.bookingDate) {
			booking.status = UnifiedBookingStatus.RESCHEDULE_REQUIRED;
			await booking.save();
			res.status(409).json({
				error:
					"No slot selected for this booking. The user has been asked to pick a time slot.",
				code: "SLOT_REQUIRED",
				booking: serializeNutritionistBooking(booking),
			});
			return;
		}

		let appointmentDate = booking.bookingDate;
		let endTimeStr = booking.endTime;

		if (booking.slotId) {
			const slot = await Slot.findById(booking.slotId).lean();
			if (!slot || slot.capacity <= 0) {
				booking.status = UnifiedBookingStatus.RESCHEDULE_REQUIRED;
				await booking.save();
				res.status(409).json({
					error:
						"Original slot is no longer available. The user has been asked to pick a new time.",
					code: "SLOT_NO_LONGER_AVAILABLE",
					booking: serializeNutritionistBooking(booking),
				});
				return;
			}
			appointmentDate = slot.date || booking.bookingDate;
			endTimeStr = slot.endTime || booking.endTime;
		}

		// Validate that the slot date/time has not already passed
		if (appointmentDate && endTimeStr) {
			const appointmentEndInstant = combineSessionDateTime(
				appointmentDate,
				endTimeStr,
			);
			if (
				appointmentEndInstant &&
				appointmentEndInstant.getTime() < now.getTime()
			) {
				booking.status = UnifiedBookingStatus.RESCHEDULE_REQUIRED;
				await booking.save();
				res.status(409).json({
					error:
						"This appointment slot date/time has already passed. The user has been asked to pick a new time.",
					code: "SLOT_EXPIRED_RESCHEDULE_REQUIRED",
					booking: serializeNutritionistBooking(booking),
				});
				return;
			}
		}

		let nutritionistName = assignedNutritionistName ?? null;
		let nutritionistIdObj: mongoose.Types.ObjectId | null = null;

		if (
			assignedNutritionistId &&
			mongoose.Types.ObjectId.isValid(assignedNutritionistId)
		) {
			nutritionistIdObj = new mongoose.Types.ObjectId(assignedNutritionistId);
			if (!nutritionistName) {
				const nutUser = await User.findById(nutritionistIdObj).select(
					"username",
				);
				if (nutUser) {
					nutritionistName = nutUser.username;
				}
			}
		}

		booking.status = UnifiedBookingStatus.CONFIRMED;
		booking.acceptedAt = new Date();

		if (clinicLocation) {
			booking.location = clinicLocation;
		}

		if (nutritionistIdObj) {
			booking.expertId = nutritionistIdObj;
			booking.expertModel = "User";
		}

		if (nutritionistName) {
			booking.assignedExpertName = nutritionistName;
		}

		// Ensure zegoRoomId exists for ONLINE mode
		if (
			booking.appointmentMode === AppointmentMode.ONLINE &&
			!booking.zegoRoomId
		) {
			booking.zegoRoomId = roomIdFor(booking._id);
		}

		try {
			await booking.save();
		} catch (err) {
			// Assigning this nutritionist would double-book them — the unique
			// index is the authority, not a prior availability read.
			if ((err as { code?: number }).code === 11000) {
				res.status(409).json({
					error:
						"That nutritionist is already booked for this date and time.",
					code: "EXPERT_DOUBLE_BOOKED",
				});
				return;
			}
			throw err;
		}

		res.status(200).json({
			message: "Nutritionist booking accepted",
			booking: serializeNutritionistBooking(booking),
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

		const booking = await UnifiedBooking.findOne({
			_id: id,
			...NUTRITIONIST_BOOKING_FILTER,
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
				error: `Booking is already ${String(booking.status).toLowerCase()} and cannot be rejected`,
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		// Release the slot capacity that bookNutritionist reserved, mirroring
		// the atomic decrement performed at creation time.
		if (booking.slotId) {
			await releaseSlotCapacity(booking.slotId.toString());
		}

		booking.status = UnifiedBookingStatus.REJECTED;
		booking.rejectedAt = new Date();
		await booking.save();

		res.status(200).json({
			message: "Nutritionist booking rejected",
			booking: serializeNutritionistBooking(booking),
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
			...NUTRITIONIST_BOOKING_FILTER,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (booking.status !== UnifiedBookingStatus.CONFIRMED) {
			res.status(400).json({
				error: "Only an accepted booking can be marked completed",
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		booking.status = UnifiedBookingStatus.COMPLETED;
		booking.meetingStatus = MeetingStatus.COMPLETED;
		booking.completedAt = new Date();
		await booking.save();

		res.status(200).json({
			message: "Nutritionist consultation marked complete",
			booking: serializeNutritionistBooking(booking),
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

		const {
			slotId,
			startTime: requestedStartTime,
			endTime: requestedEndTime,
			date,
			appointmentMode,
		} = parsed.data;

		if (slotId && !mongoose.Types.ObjectId.isValid(slotId)) {
			res.status(400).json({ error: "Invalid slotId", code: "BAD_REQUEST" });
			return;
		}

		// A healthy PENDING/ACCEPTED booking may now self-reschedule too, not
		// just one staff already bounced into RESCHEDULE_REQUIRED.
		const booking = await findMemberBooking(
			user.id,
			ACTIVE_NUTRITIONIST_STATUSES,
		);

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
			booking.status === UnifiedBookingStatus.PENDING ||
			booking.status === UnifiedBookingStatus.CONFIRMED
		) {
			const startsAt = combineSessionDateTime(
				booking.bookingDate,
				booking.startTime,
			);
			if (
				startsAt &&
				startsAt.getTime() - Date.now() < NUTRI_CANCEL_WINDOW_MINUTES * 60_000
			) {
				res.status(409).json({
					error:
						"This appointment starts too soon to reschedule yourself — please contact the front desk",
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

		const nextMode = appointmentMode
			? normalizeAppointmentModeOr(appointmentMode, AppointmentMode.ONLINE)
			: normalizeAppointmentModeOr(
					booking.appointmentMode,
					AppointmentMode.ONLINE,
				);

		let newSlotId: mongoose.Types.ObjectId | null = null;
		let newStartTime: string;
		let newEndTime: string;

		if (slotId) {
			// ── Legacy Slot path ────────────────────────────────────────────────
			// Scoped to nutritionist inventory for the same reason as
			// bookNutritionist above — a reschedule must not be able to reserve a
			// sports-scientist slot.
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
			const reservedSlot = await reserveSlotCapacity(newSlot._id.toString());

			if (!reservedSlot) {
				res.status(409).json({
					error: "Selected slot is fully booked or does not exist",
					code: "SLOT_FULL",
				});
				return;
			}

			newSlotId = newSlot._id;
			newStartTime = reservedSlot.startTime;
			newEndTime = reservedSlot.endTime;
		} else {
			// ── Pooled availability path ────────────────────────────────────────
			// The time came from GET /api/v1/experts/nutritionist/availability, so
			// it is only valid if somebody is still free then.
			newStartTime = requestedStartTime as string;
			newEndTime = requestedEndTime ?? booking.endTime;
		}

		const oldSlotId = booking.slotId;

		// Re-bind the expert against the new date/time. Keeping the old
		// assignment would carry a nutritionist into a window they may not work,
		// which is exactly the double-booking this migration removes.
		const assignment = await pickExpertForSlot({
			expertType: ExpertType.Nutritionist,
			date: rescheduledDate,
			startTime: newStartTime,
			mode: nextMode,
		});

		// On the pooled path an unbindable time means the member picked one that
		// is no longer free — refuse rather than book a nutritionist-less
		// appointment. The legacy slot path keeps its old tolerance: its capacity
		// gate already ran, and its times rarely line up with a generated grid.
		if (!assignment && !slotId) {
			res.status(409).json({
				error: "That time is no longer available. Please pick another.",
				code: "SLOT_UNAVAILABLE",
			});
			return;
		}

		if (assignment) {
			newEndTime = assignment.endTime;
		}

		booking.slotId = newSlotId;
		booking.startTime = newStartTime;
		booking.endTime = newEndTime;
		booking.bookingDate = rescheduledDate;
		booking.status = UnifiedBookingStatus.PENDING;
		booking.acceptedAt = null;
		booking.expertId = assignment?.expertId ?? null;
		booking.expertModel = assignment?.expertModel ?? "User";
		booking.assignedExpertName = assignment?.expertName ?? "";

		if (appointmentMode) {
			booking.appointmentMode = nextMode;
			if (nextMode === AppointmentMode.ONLINE && !booking.zegoRoomId) {
				booking.zegoRoomId = roomIdFor(booking._id);
			}
		}

		try {
			await booking.save();
		} catch (err) {
			if ((err as { code?: number }).code === 11000) {
				if (newSlotId) {
					await releaseSlotCapacity(newSlotId.toString()).catch(() => {});
				}
				res.status(409).json({
					error: "That time was just taken. Please pick another.",
					code: "SLOT_CONFLICT",
				});
				return;
			}
			throw err;
		}

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
			booking: serializeNutritionistBooking(booking),
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

		const booking = await UnifiedBooking.findOne({
			...NUTRITIONIST_BOOKING_FILTER,
			userId: new mongoose.Types.ObjectId(user.id),
			status: { $ne: UnifiedBookingStatus.REJECTED },
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
			booking.zegoRoomId = roomIdFor(booking._id);
		}

		// The assigned expert may be in-person-only; switching mode has to drop
		// them rather than keep an assignment their schedule doesn't support.
		if (booking.expertId) {
			const assignment = await pickExpertForSlot({
				expertType: ExpertType.Nutritionist,
				date: booking.bookingDate,
				startTime: booking.startTime,
				mode: AppointmentMode.ONLINE,
			});
			if (!assignment) {
				booking.expertId = null;
				booking.assignedExpertName = "";
			}
		}

		if (parsed.data.notes) {
			booking.memberNotes = parsed.data.notes;
		}

		await booking.save();

		res.status(200).json({
			message: "Switched to online mode successfully",
			booking: serializeNutritionistBooking(booking),
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
		const booking = await findMemberBooking(
			user.id,
			ACTIVE_NUTRITIONIST_STATUSES,
		);

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
		const startsAt = combineSessionDateTime(
			booking.bookingDate,
			booking.startTime,
		);
		if (
			startsAt &&
			startsAt.getTime() - Date.now() < NUTRI_CANCEL_WINDOW_MINUTES * 60_000
		) {
			res.status(409).json({
				error:
					"This appointment starts too soon to cancel yourself — please contact the front desk",
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

		booking.status = UnifiedBookingStatus.CANCELLED;
		booking.cancelledAt = new Date();
		booking.cancelledBy = "user";
		booking.cancellationReason = parsed.data.reason ?? null;
		await booking.save();

		res.status(200).json({
			message: "Nutritionist booking cancelled",
			booking: serializeNutritionistBooking(booking),
		});
	} catch (error) {
		next(error);
	}
};
