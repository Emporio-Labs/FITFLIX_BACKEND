import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { AppointmentMode, MeetingStatus, NutritionistBookingStatus, OnboardingStep } from "../models/Enums";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import User from "../models/User";
import { advanceStep, getOnboardingStatus } from "../utils/onboarding.service";
import {
	acceptNutritionistBookingSchema,
	bookNutritionistSchema,
	rescheduleNutritionistBookingSchema,
	switchToOnlineSchema,
} from "../validators/nutritionist-booking.validator";

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

		if (slotId && mongoose.Types.ObjectId.isValid(slotId)) {
			resolvedSlotId = new mongoose.Types.ObjectId(slotId);
			const slot = await Slot.findById(resolvedSlotId);
			if (slot) {
				if (slot.remainingCapacity <= 0) {
					res.status(400).json({
						error: "Selected slot is fully booked",
						code: "SLOT_FULL",
					});
					return;
				}
				startTime = slot.startTime;
				endTime = slot.endTime;
				// Atomically decrement slot capacity
				await Slot.findByIdAndUpdate(resolvedSlotId, {
					$inc: { remainingCapacity: -1 },
					$set: { isBooked: slot.remainingCapacity - 1 <= 0 },
				});
			}
		}

		const bookingDate = new Date(date);

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
			if (
				!onboardingStatus.onboardingCompleted &&
				onboardingStatus.currentStep === OnboardingStep.REPORT_UPLOAD
			) {
				await advanceStep(user.id, OnboardingStep.REPORT_UPLOAD);
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
		// and admin action, an admin might have deleted or retired the slot.
		// Accepting anyway would silently confirm the user against a slot
		// they can't actually use.
		//
		// NOTE: remainingCapacity == 0 is a normal fully-booked state — this
		// booking's seat was already decremented at book time, so its hold is
		// still valid. Only treat missing-slot or retired-slot (capacity == 0)
		// as reason to reschedule.
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
			await Slot.findByIdAndUpdate(booking.slotId, {
				$inc: { remainingCapacity: 1 },
				$set: { isBooked: false },
			});
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

		const { slotId, date } = parsed.data;

		if (!mongoose.Types.ObjectId.isValid(slotId)) {
			res.status(400).json({ error: "Invalid slotId", code: "BAD_REQUEST" });
			return;
		}

		// Guard: only the caller's own booking that's in RESCHEDULE_REQUIRED
		// state can be rescheduled. This is the exact state acceptBooking flips
		// a booking into when its original slot is no longer available.
		const booking = await NutritionistBooking.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: NutritionistBookingStatus.RESCHEDULE_REQUIRED,
		}).sort({ createdAt: -1 });

		if (!booking) {
			res.status(404).json({
				error: "No booking awaiting reschedule was found",
				code: "NOT_FOUND",
			});
			return;
		}

		// Atomically reserve the new slot before touching the booking, so a
		// failed reservation leaves everything unchanged.
		const newSlotId = new mongoose.Types.ObjectId(slotId);
		const newSlot = await Slot.findOneAndUpdate(
			{ _id: newSlotId, remainingCapacity: { $gt: 0 } },
			{
				$inc: { remainingCapacity: -1 },
			},
			{ returnDocument: "after" },
		);

		if (!newSlot) {
			res.status(409).json({
				error: "Selected slot is fully booked or does not exist",
				code: "SLOT_FULL",
			});
			return;
		}

		// Flip isBooked once the reserve took effect and reflected the new count.
		if (newSlot.remainingCapacity <= 0) {
			await Slot.findByIdAndUpdate(newSlotId, { $set: { isBooked: true } });
		}

		const oldSlotId = booking.slotId;

		booking.slotId = newSlotId;
		booking.startTime = newSlot.startTime;
		booking.endTime = newSlot.endTime;
		if (date) {
			const parsedDate = new Date(date);
			if (!Number.isNaN(parsedDate.getTime())) {
				booking.bookingDate = parsedDate;
			}
		}
		booking.status = NutritionistBookingStatus.PENDING;
		booking.acceptedAt = null;
		await booking.save();

		// Release the old slot last, wrapped so a release failure doesn't hide
		// the successful reservation + booking update above.
		if (oldSlotId) {
			try {
				await Slot.findByIdAndUpdate(oldSlotId, {
					$inc: { remainingCapacity: 1 },
					$set: { isBooked: false },
				});
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
