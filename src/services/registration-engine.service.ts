import mongoose from "mongoose";
import Bookings from "../models/Bookings";
import ScheduledSession from "../models/ScheduledSession";
import { evaluateBookingRules } from "./booking-rules-engine.service";
import { allocateSeatAtomic, releaseSeatAtomic } from "./capacity-engine.service";

export interface GroupClassRegistrationResult {
	success: boolean;
	statusCode?: 201 | 400 | 403 | 404 | 409 | 500;
	message?: string;
	booking?: any;
	remainingCapacity?: number;
	details?: any;
	reason?: string;
}

export async function registerGroupClassBooking(params: {
	userId: string;
	sessionId: string;
	classId?: string;
}): Promise<GroupClassRegistrationResult> {
	// 1. Session Verification
	const session = await ScheduledSession.findById(params.sessionId);
	if (!session) {
		return {
			success: false,
			statusCode: 404,
			message: "Scheduled session not found",
		};
	}

	if (session.status === "CANCELLED" || session.status === "COMPLETED") {
		return {
			success: false,
			statusCode: 400,
			message: `Cannot book a session with status ${session.status}`,
		};
	}

	const targetClassId = params.classId || session.classId.toString();

	// 2. Booking Window Rule Evaluation (FEATURE-012 Engine)
	const rulesEval = await evaluateBookingRules({
		userId: params.userId,
		classId: targetClassId,
		sessionId: params.sessionId,
		sessionDate: session.sessionDate,
		startTime: session.startTime,
	});

	if (!rulesEval.allowed) {
		return {
			success: false,
			statusCode: rulesEval.statusCode || 403,
			message: rulesEval.message,
			details: rulesEval.details,
		};
	}

	// 3. Duplicate Booking Prevention Guard (409 Conflict)
	const userObjId = mongoose.Types.ObjectId.isValid(params.userId)
		? new mongoose.Types.ObjectId(params.userId)
		: params.userId;

	const existingBooking = await Bookings.findOne({
		user: userObjId,
		sessionId: params.sessionId,
		status: { $nin: ["Cancelled", "CANCELLED"] },
	});

	if (existingBooking) {
		return {
			success: false,
			statusCode: 409,
			message: "Member is already registered for this class session",
		};
	}

	// 4. Atomic Capacity Reservation (FEATURE-011 Engine)
	const seatAllocation = await allocateSeatAtomic(params.sessionId);
	if (!seatAllocation.success) {
		return {
			success: false,
			statusCode: 409,
			message: "Session capacity is full",
			reason: seatAllocation.reason,
		};
	}

	// 5. Create Booking Document inside Transaction Safety
	try {
		const booking = await Bookings.create({
			user: userObjId,
			sessionId: params.sessionId,
			classId: targetClassId,
			bookingDate: session.sessionDate,
			startTime: session.startTime,
			endTime: session.endTime,
			status: "Confirmed",
			creditCostSnapshot: 1,
			creditsBypassed: true,
		});

		return {
			success: true,
			statusCode: 201,
			message: "Class booking registration confirmed",
			booking: {
				id: booking._id.toString(),
				userId: params.userId,
				sessionId: params.sessionId,
				classId: targetClassId,
				bookingDate: booking.bookingDate,
				startTime: booking.startTime,
				endTime: booking.endTime,
				status: booking.status,
				createdAt: booking.createdAt,
			},
			remainingCapacity: seatAllocation.session?.remainingCapacity ?? 0,
		};
	} catch (error: any) {
		// Rollback atomic seat allocation on database write failure
		await releaseSeatAtomic(params.sessionId);

		if (error.code === 11000) {
			return {
				success: false,
				statusCode: 409,
				message: "Member is already registered for this class session",
			};
		}
		throw error;
	}
}
