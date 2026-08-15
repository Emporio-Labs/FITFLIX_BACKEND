import mongoose from "mongoose";
import {
	AppointmentMode,
	CreditTransactionSource,
	CreditTransactionType,
	MeetingStatus,
	MembershipStatus,
	ServiceCategory,
	ServiceSubtype,
	TrainerChangeRequestStatus,
	UnifiedBookingStatus,
} from "../models/Enums";
import CreditTransaction from "../models/CreditTransaction";
import Invoice from "../models/Invoice";
import Membership from "../models/Membership";
import Trainer from "../models/Trainer";
import TrainerChangeRequest from "../models/TrainerChangeRequest";
import UnifiedBooking from "../models/UnifiedBooking";
import { executeInTransaction } from "../utils/transaction.util";

export class SlotConflictError extends Error {
	constructor(message = "The selected time slot is already booked or overlaps with another session.") {
		super(message);
		this.name = "SlotConflictError";
	}
}

export class InsufficientQuotaError extends Error {
	constructor(message = "You have 0 active PT sessions remaining in your current billing cycle.") {
		super(message);
		this.name = "InsufficientQuotaError";
	}
}

export const createPersonalTrainingBooking = async (params: {
	userId: string;
	trainerId: string;
	bookingDate: string | Date;
	startTime: string;
	endTime: string;
	appointmentMode?: AppointmentMode;
	location?: string;
	consumptionModel?: "CREDIT_POOL" | "DIRECT_PURCHASE";
	invoiceId?: string;
}) => {
	const userObjId = new mongoose.Types.ObjectId(params.userId);
	const trainerObjId = new mongoose.Types.ObjectId(params.trainerId);
	const rawDateStr =
		typeof params.bookingDate === "string"
			? params.bookingDate.slice(0, 10)
			: params.bookingDate.toISOString().slice(0, 10);
	const bookingDate = new Date(`${rawDateStr}T00:00:00.000Z`);
	const appointmentMode = params.appointmentMode || AppointmentMode.ONLINE;
	const consumptionModel = params.consumptionModel || "CREDIT_POOL";

	return executeInTransaction(async (session) => {
		// 1. Verify Trainer exists and is active
		const trainer = await Trainer.findById(trainerObjId).session(session);
		if (!trainer || trainer.isActive === false) {
			throw new Error("Selected trainer is not available or inactive.");
		}

		// 2. Concurrency check: Range intersection guard for overlapping bookings
		const startOfDay = new Date(bookingDate);
		startOfDay.setUTCHours(0, 0, 0, 0);
		const endOfDay = new Date(bookingDate);
		endOfDay.setUTCHours(23, 59, 59, 999);

		const conflictingBooking = await UnifiedBooking.findOne({
			expertId: trainerObjId,
			bookingDate: { $gte: startOfDay, $lte: endOfDay },
			status: {
				$in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED],
			},
			startTime: { $lt: params.endTime },
			endTime: { $gt: params.startTime },
		}).session(session);

		if (conflictingBooking) {
			throw new SlotConflictError(
				`Trainer ${trainer.trainerName} already has a session booked from ${conflictingBooking.startTime} to ${conflictingBooking.endTime}.`,
			);
		}

		let activeMembership: any = null;
		let creditCostSnapshot = 1;
		let creditsBypassed = false;

		// 3. Quota deduction if using credit pool
		if (consumptionModel === "CREDIT_POOL") {
			const now = new Date();
			activeMembership = await Membership.findOneAndUpdate(
				{
					user: userObjId,
					status: MembershipStatus.Active,
					$or: [
						{ category: "PERSONAL_TRAINING" },
						{ ptSessionsIncluded: { $gt: 0 } },
					],
					$and: [
						{ startDate: { $lte: now } },
						{ $or: [{ endDate: { $gte: now } }, { endDate: null }] },
					],
					ptSessionsRemaining: { $gte: 1 }, // Atomic guard preventing negative balances
				},
				{
					$inc: { ptSessionsRemaining: -1, ptSessionsUsed: 1 },
				},
				{ new: true, session },
			);

			if (!activeMembership) {
				// Check if membership exists but 0 sessions left
				const existingMembership = await Membership.findOne({
					user: userObjId,
					status: MembershipStatus.Active,
					$or: [
						{ category: "PERSONAL_TRAINING" },
						{ ptSessionsIncluded: { $gt: 0 } },
					],
				}).session(session);

				if (existingMembership) {
					throw new InsufficientQuotaError(
						"You have used all sessions in your active PT plan. Please renew early or purchase a drop-in session.",
					);
				}
				throw new InsufficientQuotaError(
					"No active Personal Training package found for your account.",
				);
			}

			// Log credit audit transaction
			await CreditTransaction.create(
				[
					{
						user: userObjId,
						membership: activeMembership._id,
						amount: 1,
						type: CreditTransactionType.Consume,
						sourceType: CreditTransactionSource.PersonalTraining,
						sourceId: trainerObjId,
						actorRole: "user",
						reason: `Consumed 1 PT Session with ${trainer.trainerName} on ${params.startTime}`,
					},
				],
				{ session },
			);
		} else {
			// Direct In-App Purchase
			creditCostSnapshot = 0;
			creditsBypassed = true;
		}

		// 4. Create Unified Booking record
		const booking = new UnifiedBooking({
			userId: userObjId,
			serviceCategory: ServiceCategory.EXPERT_SESSION,
			serviceSubtype: ServiceSubtype.TRAINER,
			expertId: trainerObjId,
			assignedExpertName: trainer.trainerName,
			packageId: activeMembership?._id || null,
			bookingDate,
			startTime: params.startTime,
			endTime: params.endTime,
			appointmentMode,
			location:
				appointmentMode === AppointmentMode.ONLINE
					? "Online Video Room"
					: params.location || "FitFlix Wellness Club — Sainikpuri",
			status: UnifiedBookingStatus.CONFIRMED,
			meetingStatus: MeetingStatus.SCHEDULED,
			consumptionModel,
			creditCostSnapshot,
			creditsBypassed,
			invoiceId: params.invoiceId
				? new mongoose.Types.ObjectId(params.invoiceId)
				: null,
		});

		if (appointmentMode === AppointmentMode.ONLINE) {
			booking.zegoRoomId = `session_${booking._id.toString()}`;
		}

		await booking.save({ session });
		return booking;
	});
};

export const cancelUnifiedBooking = async (params: {
	bookingId: string;
	requesterId: string;
	requesterRole: string;
	reason?: string;
	adminOverride?: boolean;
	now?: Date;
}) => {
	const now = params.now || new Date();
	const bookingObjId = new mongoose.Types.ObjectId(params.bookingId);

	return executeInTransaction(async (session) => {
		const booking = await UnifiedBooking.findById(bookingObjId).session(session);
		if (!booking) {
			throw new Error("Booking not found");
		}

		// Authorization check
		const isOwner = String(booking.userId) === String(params.requesterId);
		const isStaffOrAdmin =
			params.requesterRole === "admin" ||
			params.requesterRole === "frontdesk" ||
			params.requesterRole === "staff";

		if (!isOwner && !isStaffOrAdmin) {
			throw new Error("Forbidden: You cannot cancel another member's booking");
		}

		if (
			booking.status === UnifiedBookingStatus.CANCELLED ||
			booking.status === UnifiedBookingStatus.COMPLETED
		) {
			throw new Error(`Booking cannot be cancelled because it is already ${booking.status}`);
		}

		// Calculate hours until session start
		const [hours, minutes] = String(booking.startTime).split(":").map(Number);
		const sessionStartDateTime = new Date(booking.bookingDate);
		sessionStartDateTime.setHours(hours || 0, minutes || 0, 0, 0);

		const msUntilStart = sessionStartDateTime.getTime() - now.getTime();
		const hoursUntilStart = msUntilStart / (1000 * 60 * 60);

		const isEarlyCancellation = hoursUntilStart >= 24;
		const isAdminOverride = Boolean(params.adminOverride) && isStaffOrAdmin;
		const shouldRefundCredits = isEarlyCancellation || isAdminOverride;

		booking.status = UnifiedBookingStatus.CANCELLED;
		let creditRefunded = 0;

		// Refund quota if applicable
		if (shouldRefundCredits && booking.creditCostSnapshot > 0 && booking.packageId) {
			await Membership.findByIdAndUpdate(
				booking.packageId,
				{
					$inc: { ptSessionsRemaining: 1, ptSessionsUsed: -1 },
				},
				{ session },
			);

			await CreditTransaction.create(
				[
					{
						user: booking.userId,
						membership: booking.packageId,
						amount: 1,
						type: CreditTransactionType.Refund,
						sourceType: CreditTransactionSource.PersonalTraining,
						sourceId: booking._id,
						actorId: params.requesterId ? new mongoose.Types.ObjectId(params.requesterId) : undefined,
						actorRole: params.requesterRole,
						reason: isAdminOverride
							? `Admin override refund for cancelled PT booking ${booking._id.toString()}`
							: `24-hour early cancellation refund for PT booking ${booking._id.toString()}`,
					},
				],
				{ session },
			);
			creditRefunded = 1;
		}

		await booking.save({ session });

		return {
			success: true,
			booking,
			isEarlyCancellation,
			isAdminOverride,
			refunded: shouldRefundCredits,
			creditRefunded,
		};
	});
};

export const completeUnifiedBooking = async (
	bookingId: string,
	notesData: {
		workoutNotes?: string;
		exercisesCompleted?: Array<{
			exerciseId?: string;
			name: string;
			sets: number;
			reps: number;
			weight: number;
			notes?: string;
		}>;
		clinicalNotes?: string;
	},
	actorId?: string,
) => {
	const booking = await UnifiedBooking.findByIdAndUpdate(
		bookingId,
		{
			$set: {
				status: UnifiedBookingStatus.COMPLETED,
				meetingStatus: MeetingStatus.COMPLETED,
				completedAt: new Date(),
				sessionNotes: notesData,
			},
		},
		{ new: true },
	);
	return booking;
};

export const createTrainerChangeRequest = async (params: {
	userId: string;
	requestedTrainerId: string;
	reason: string;
}) => {
	const userObjId = new mongoose.Types.ObjectId(params.userId);
	const reqTrainerObjId = new mongoose.Types.ObjectId(params.requestedTrainerId);

	// Get current active membership trainer
	const membership = await Membership.findOne({
		user: userObjId,
		status: MembershipStatus.Active,
		$or: [
			{ category: "PERSONAL_TRAINING" },
			{ ptSessionsIncluded: { $gt: 0 } },
		],
	});

	const request = await TrainerChangeRequest.create({
		userId: userObjId,
		currentTrainerId: membership?.assignedTrainerId || null,
		requestedTrainerId: reqTrainerObjId,
		reason: params.reason,
		status: TrainerChangeRequestStatus.PENDING,
	});

	return request;
};

export const resolveTrainerChangeRequest = async (
	requestId: string,
	action: "APPROVE" | "REJECT",
	adminNotes: string,
	adminUserId: string,
) => {
	const request = await TrainerChangeRequest.findById(requestId);
	if (!request) {
		throw new Error("Trainer change request not found");
	}

	const newStatus =
		action === "APPROVE"
			? TrainerChangeRequestStatus.APPROVED
			: TrainerChangeRequestStatus.REJECTED;

	request.status = newStatus;
	request.adminNotes = adminNotes || "";
	request.resolvedBy = new mongoose.Types.ObjectId(adminUserId);
	request.resolvedAt = new Date();
	await request.save();

	if (action === "APPROVE") {
		const newTrainer = await Trainer.findById(request.requestedTrainerId);
		if (newTrainer) {
			await Membership.updateMany(
				{
					user: request.userId,
					status: MembershipStatus.Active,
					$or: [
						{ category: "PERSONAL_TRAINING" },
						{ ptSessionsIncluded: { $gt: 0 } },
					],
				},
				{
					$set: {
						assignedTrainerId: newTrainer._id,
						assignedTrainerName: newTrainer.trainerName,
					},
				},
			);
		}
	}

	return request;
};
