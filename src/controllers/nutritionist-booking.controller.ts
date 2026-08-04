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

export const acceptBooking: RequestHandler = async (req, res, next) => {
	try {
		const idParam = req.params.id;
		const id = typeof idParam === "string" ? idParam : undefined;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ error: "Invalid booking ID", code: "BAD_REQUEST" });
			return;
		}

		const parsed = acceptNutritionistBookingSchema.safeParse(req.body);
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
