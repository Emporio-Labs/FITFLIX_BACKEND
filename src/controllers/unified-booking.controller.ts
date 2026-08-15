import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	AppointmentMode,
	ExpertType,
	MembershipStatus,
	ServiceCategory,
	ServiceSubtype,
	TrainerChangeRequestStatus,
	UnifiedBookingStatus,
} from "../models/Enums";
import Membership from "../models/Membership";
import { buildActivePtMembershipFilter } from "../utils/membership-status.util";
import Trainer from "../models/Trainer";
import TrainerChangeRequest from "../models/TrainerChangeRequest";
import UnifiedBooking from "../models/UnifiedBooking";
import User from "../models/User";
import {
	calculateAvailableSlots,
	getOrCreateExpertSchedule,
	updateExpertSchedule,
} from "../services/expert-schedule.service";
import {
	TrainerLockedError,
	cancelUnifiedBooking,
	completeUnifiedBooking,
	createPersonalTrainingBooking,
	createTrainerChangeRequest,
	resolveTrainerChangeRequest,
} from "../services/unified-booking.service";

export const getTrainers: RequestHandler = async (_req, res, next) => {
	try {
		const trainers = await Trainer.find({ isActive: { $ne: false } }).select(
			"trainerName description specialities imageUrl keySentence isActive email phone",
		);

		const formatted = trainers.map((t) => ({
			_id: t._id.toString(),
			name: t.trainerName,
			description: t.description || "",
			specialities: t.specialities || [],
			imageUrl: t.imageUrl || "",
			keySentence: t.keySentence || "",
			isActive: t.isActive !== false,
		}));

		res.status(200).json({ trainers: formatted });
	} catch (error) {
		next(error);
	}
};

export const getTrainerAvailability: RequestHandler = async (req, res, next) => {
	try {
		const { id } = req.params;
		const { date } = req.query;

		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ message: "Invalid trainer ID" });
			return;
		}

		if (!date || typeof date !== "string") {
			res.status(400).json({ message: "date query param is required (YYYY-MM-DD)" });
			return;
		}

		const slots = await calculateAvailableSlots(id, date);
		res.status(200).json({ trainerId: id, date, slots });
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to calculate slots" });
	}
};

export const getTrainerSchedule: RequestHandler = async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ message: "Invalid trainer ID" });
			return;
		}

		const schedule = await getOrCreateExpertSchedule(id, ExpertType.Trainer);
		res.status(200).json({ schedule });
	} catch (error) {
		next(error);
	}
};

export const updateTrainerScheduleHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { id } = req.params;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ message: "Invalid trainer ID" });
			return;
		}

		const user = req.user;
		// Trainers can only update their own schedule; Admins/Frontdesk can update any
		if (
			user?.role === "trainer" &&
			String(user.id) !== String(id)
		) {
			res.status(403).json({ message: "Forbidden: You can only edit your own schedule" });
			return;
		}

		const schedule = await updateExpertSchedule(id, req.body);
		res.status(200).json({ message: "Schedule updated successfully", schedule });
	} catch (error) {
		next(error);
	}
};

export const getMyPtPackage: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const now = new Date();
		const membership = await Membership.findOne(
			buildActivePtMembershipFilter(user.id, now),
		).populate("assignedTrainerId", "trainerName imageUrl specialities keySentence");

		if (!membership) {
			res.status(200).json({
				hasActivePackage: false,
				package: null,
			});
			return;
		}

		let assignedTrainer = membership.assignedTrainerId as any;

		// Fallback check on User.assignedTrainer if membership assignedTrainerId was empty
		if (!assignedTrainer) {
			const userDoc = await User.findById(user.id).populate(
				"assignedTrainer",
				"trainerName imageUrl specialities keySentence",
			);
			if (userDoc?.assignedTrainer) {
				assignedTrainer = userDoc.assignedTrainer as any;
				// Sync back onto membership
				await Membership.findByIdAndUpdate(membership._id, {
					$set: {
						assignedTrainerId: assignedTrainer._id,
						assignedTrainerName: assignedTrainer.trainerName || "",
					},
				});
			}
		}

		// Check for any active pending trainer change request
		const pendingChange = await TrainerChangeRequest.findOne({
			userId: new mongoose.Types.ObjectId(user.id),
			status: TrainerChangeRequestStatus.PENDING,
		}).populate("requestedTrainerId", "trainerName imageUrl specialities");

		res.status(200).json({
			hasActivePackage: true,
			package: {
				id: membership._id.toString(),
				planName: membership.planName,
				category: membership.category,
				ptSessionsIncluded: membership.ptSessionsIncluded || 0,
				ptSessionsRemaining: membership.ptSessionsRemaining || 0,
				ptSessionsUsed: membership.ptSessionsUsed || 0,
				startDate: membership.startDate,
				endDate: membership.endDate,
				assignedTrainer: assignedTrainer
					? {
							id: assignedTrainer._id.toString(),
							name: assignedTrainer.trainerName,
							imageUrl: assignedTrainer.imageUrl || "",
							specialities: assignedTrainer.specialities || [],
							keySentence: assignedTrainer.keySentence || "",
						}
					: null,
				pendingTrainerChange: pendingChange
					? {
							id: pendingChange._id.toString(),
							requestedTrainerId:
								(pendingChange.requestedTrainerId as any)?._id?.toString() ||
								pendingChange.requestedTrainerId?.toString(),
							requestedTrainerName:
								(pendingChange.requestedTrainerId as any)?.trainerName || "Coach",
							reason: pendingChange.reason || "",
							createdAt: pendingChange.createdAt,
						}
					: null,
				allowEarlyRenewal: membership.allowEarlyRenewal !== false,
			},
		});
	} catch (error) {
		next(error);
	}
};

export const bookPersonalTraining: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const {
			trainerId,
			bookingDate,
			startTime,
			endTime,
			appointmentMode,
			location,
			consumptionModel,
			invoiceId,
		} = req.body;

		if (!trainerId || !bookingDate || !startTime || !endTime) {
			res.status(400).json({
				message: "trainerId, bookingDate, startTime, and endTime are required",
			});
			return;
		}

		const booking = await createPersonalTrainingBooking({
			userId: user.id,
			trainerId,
			bookingDate,
			startTime,
			endTime,
			appointmentMode,
			location,
			consumptionModel,
			invoiceId,
		});

		res.status(201).json({
			message: "Personal training session booked successfully",
			booking,
		});
	} catch (error: any) {
		if (error.name === "TrainerLockedError") {
			res.status(403).json({ message: error.message, code: "TRAINER_LOCKED" });
			return;
		}
		if (error.name === "SlotConflictError") {
			res.status(409).json({ message: error.message, code: "SLOT_CONFLICT" });
			return;
		}
		if (error.name === "InsufficientQuotaError") {
			res.status(400).json({ message: error.message, code: "INSUFFICIENT_QUOTA" });
			return;
		}
		res.status(400).json({ message: error.message || "Failed to book session" });
	}
};

export const getMyBookings: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const bookings = await UnifiedBooking.find({
			userId: new mongoose.Types.ObjectId(user.id),
			serviceCategory: ServiceCategory.EXPERT_SESSION,
		})
			.sort({ bookingDate: -1, startTime: -1 })
			.populate("expertId", "trainerName imageUrl specialities");

		res.status(200).json({ bookings });
	} catch (error) {
		next(error);
	}
};

export const getBookingById: RequestHandler = async (req, res, next) => {
	try {
		const { id } = req.params;
		if (!id || !mongoose.Types.ObjectId.isValid(id)) {
			res.status(400).json({ message: "Invalid booking ID" });
			return;
		}

		const booking = await UnifiedBooking.findById(id).populate(
			"expertId",
			"trainerName imageUrl specialities email phone",
		);

		if (!booking) {
			res.status(404).json({ message: "Booking not found" });
			return;
		}

		res.status(200).json({ booking });
	} catch (error) {
		next(error);
	}
};

export const cancelBookingHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { id } = req.params;
		const { reason, adminOverride } = req.body || {};

		const result = await cancelUnifiedBooking({
			bookingId: id,
			requesterId: user.id,
			requesterRole: user.role,
			reason,
			adminOverride: Boolean(adminOverride),
		});

		res.status(200).json({
			message: result.refunded
				? "Booking cancelled and 1 session quota refunded to your account"
				: "Booking cancelled successfully",
			result,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to cancel booking" });
	}
};

export const submitTrainerChangeRequest: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { requestedTrainerId, reason } = req.body;
		if (!requestedTrainerId || !reason) {
			res.status(400).json({
				message: "requestedTrainerId and reason are required",
			});
			return;
		}

		const request = await createTrainerChangeRequest({
			userId: user.id,
			requestedTrainerId,
			reason,
		});

		res.status(201).json({
			message: "Trainer change request submitted. Frontdesk will review shortly.",
			request,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to submit request" });
	}
};

// ── Admin & Staff Endpoints ──────────────────────────────────────────────────

export const getAllBookingsAdmin: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		const { expertId, status, date, serviceCategory } = req.query;
		const filter: Record<string, unknown> = {};

		// Strict Role Scoping: A trainer may ONLY see their own bookings!
		if (requester?.role === "trainer") {
			filter.expertId = new mongoose.Types.ObjectId(requester.id);
		} else if (expertId && mongoose.Types.ObjectId.isValid(String(expertId))) {
			filter.expertId = new mongoose.Types.ObjectId(String(expertId));
		}

		if (status) {
			filter.status = status;
		}
		if (serviceCategory) {
			filter.serviceCategory = serviceCategory;
		}
		if (date && typeof date === "string") {
			const targetDate = new Date(date);
			const startOfDay = new Date(targetDate);
			startOfDay.setUTCHours(0, 0, 0, 0);
			const endOfDay = new Date(targetDate);
			endOfDay.setUTCHours(23, 59, 59, 999);
			filter.bookingDate = { $gte: startOfDay, $lte: endOfDay };
		}

		const bookings = await UnifiedBooking.find(filter)
			.sort({ bookingDate: -1, startTime: -1 })
			.populate("userId", "username email phone")
			.populate("expertId", "trainerName imageUrl specialities");

		res.status(200).json({ bookings });
	} catch (error) {
		next(error);
	}
};

export const completeBookingAdmin: RequestHandler = async (req, res, next) => {
	try {
		const { id } = req.params;
		const { workoutNotes, exercisesCompleted, clinicalNotes } = req.body || {};

		const booking = await completeUnifiedBooking(
			id,
			{
				workoutNotes,
				exercisesCompleted,
				clinicalNotes,
			},
			req.user?.id,
		);

		res.status(200).json({
			message: "Session completed and notes saved successfully",
			booking,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to complete session" });
	}
};

export const getTrainerChangeRequestsAdmin: RequestHandler = async (
	_req,
	res,
	next,
) => {
	try {
		const requests = await TrainerChangeRequest.find()
			.sort({ createdAt: -1 })
			.populate("userId", "username email phone")
			.populate("currentTrainerId", "trainerName imageUrl")
			.populate("requestedTrainerId", "trainerName imageUrl");

		const formatted = requests.map((r: any) => {
			const obj = r.toObject ? r.toObject() : { ...r };
			const reqId = r._id?.toString() || r.id?.toString() || "";
			return {
				...obj,
				id: reqId,
				_id: reqId,
			};
		});

		res.status(200).json({ requests: formatted });
	} catch (error) {
		next(error);
	}
};

export const resolveTrainerChangeRequestAdmin: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { id } = req.params;
		const { action, adminNotes } = req.body;

		if (action !== "APPROVE" && action !== "REJECT") {
			res.status(400).json({ message: "action must be APPROVE or REJECT" });
			return;
		}

		const adminId =
			(req.user as any)?.id ||
			(req.user as any)?._id ||
			(req.user as any)?.userId;

		const request = await resolveTrainerChangeRequest(
			id,
			action,
			adminNotes,
			adminId ? String(adminId) : undefined,
		);

		res.status(200).json({
			message: `Trainer change request ${action === "APPROVE" ? "approved" : "rejected"} successfully`,
			request,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to resolve request" });
	}
};
