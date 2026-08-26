import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	AppointmentBookingStatus,
	ExpertType,
	MeetingStatus,
	OnboardingStep,
} from "../models/Enums";
import ExpertAppointment from "../models/ExpertAppointment";
import Slot from "../models/Slots";
import User from "../models/User";
import { releaseSlotCapacity } from "../services/slot-reservation.service";
import { updateSharedOnboardingStep } from "../utils/onboarding.service";
import { combineSessionDateTime } from "../utils/zego-room";
import {
	acceptSportsScientistBookingSchema,
	rejectSportsScientistBookingSchema,
} from "../validators/expert-appointment.validator";

export const getAllBookingsForAdmin: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { status } = req.query;
		const query: Record<string, unknown> = {
			expertType: ExpertType.SportsScientist,
		};

		if (typeof status === "string" && status.trim()) {
			const requested = status.trim().toLowerCase();
			const matched = (
				Object.values(AppointmentBookingStatus) as string[]
			).find((v) => v.toLowerCase() === requested);
			if (!matched) {
				res.status(400).json({
					error: "Invalid status filter",
					code: "BAD_REQUEST",
				});
				return;
			}
			query.bookingStatus = matched;
		}

		const bookings = await ExpertAppointment.find(query)
			.populate("userId", "username email phone")
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

		const {
			meetingLink,
			clinicLocation,
			assignedExpertId,
			assignedExpertName,
		} = parsed.data;

		const booking = await ExpertAppointment.findOne({
			_id: id,
			expertType: ExpertType.SportsScientist,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.bookingStatus === AppointmentBookingStatus.Completed ||
			booking.bookingStatus === AppointmentBookingStatus.Rejected ||
			booking.bookingStatus === AppointmentBookingStatus.Cancelled
		) {
			res.status(400).json({
				error: `Booking is already ${booking.bookingStatus.toLowerCase()} and cannot be accepted`,
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		const now = new Date();

		let appointmentDate = booking.appointmentDate;
		let endTimeStr = booking.endTime;

		if (booking.slotId) {
			const slot = await Slot.findById(booking.slotId).lean();
			if (!slot || slot.capacity <= 0) {
				res.status(409).json({
					error:
						"Original slot is no longer available. The user has been asked to pick a new time.",
					code: "SLOT_NO_LONGER_AVAILABLE",
					booking,
				});
				return;
			}
			appointmentDate = slot.date || booking.appointmentDate;
			endTimeStr = slot.endTime || booking.endTime;
		}

		if (appointmentDate && endTimeStr) {
			const appointmentEndInstant = combineSessionDateTime(
				appointmentDate,
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
					booking,
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

		booking.bookingStatus = AppointmentBookingStatus.Confirmed;
		booking.meetingStatus = MeetingStatus.SCHEDULED;
		booking.acceptedAt = new Date();

		if (meetingLink !== undefined) {
			booking.meetingLink = meetingLink || null;
		}

		if (clinicLocation !== undefined) {
			booking.clinicLocation = clinicLocation || null;
		}

		if (expertIdObj) {
			booking.assignedExpertId = expertIdObj;
		}

		if (expertName) {
			booking.assignedExpertName = expertName;
		}

		await booking.save();

		res.status(200).json({
			message: "Sports scientist booking accepted",
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

		const booking = await ExpertAppointment.findOne({
			_id: id,
			expertType: ExpertType.SportsScientist,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (
			booking.bookingStatus === AppointmentBookingStatus.Rejected ||
			booking.bookingStatus === AppointmentBookingStatus.Completed
		) {
			res.status(400).json({
				error: `Booking is already ${booking.bookingStatus.toLowerCase()} and cannot be rejected`,
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

		booking.bookingStatus = AppointmentBookingStatus.Rejected;
		booking.rejectedAt = new Date();
		booking.rejectionReason = rejectionReason ?? null;

		await booking.save();

		res.status(200).json({
			message: "Sports scientist booking rejected",
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

		const booking = await ExpertAppointment.findOne({
			_id: id,
			expertType: ExpertType.SportsScientist,
		});
		if (!booking) {
			res.status(404).json({ error: "Booking not found", code: "NOT_FOUND" });
			return;
		}

		if (booking.bookingStatus !== AppointmentBookingStatus.Confirmed) {
			res.status(400).json({
				error: "Only a confirmed booking can be marked completed",
				code: "INVALID_STATUS_TRANSITION",
			});
			return;
		}

		booking.bookingStatus = AppointmentBookingStatus.Completed;
		booking.meetingStatus = MeetingStatus.COMPLETED;
		booking.completedAt = new Date();

		await booking.save();

		res.status(200).json({
			message: "Sports scientist consultation marked complete",
			booking,
		});
	} catch (error) {
		next(error);
	}
};
