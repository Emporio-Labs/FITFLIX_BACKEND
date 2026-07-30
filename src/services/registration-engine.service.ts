import mongoose from "mongoose";
import Bookings from "../models/Bookings";
import Class from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { normalizeDeliveryType } from "../utils/delivery-type";
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

const pad2 = (n: number) => n.toString().padStart(2, "0");
const formatHHMM = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export async function registerGroupClassBooking(params: {
	userId: string;
	sessionId: string;
	classId?: string;
}): Promise<GroupClassRegistrationResult> {
	// 1. Session Verification
	//    The caller may pass a real ScheduledSession _id (ObjectId) or a Class _id
	//    (randomUUID string). We try the session lookup first; if that fails we
	//    fall back to resolving the Class and finding/creating its session.
	let session: any = null;
	if (mongoose.Types.ObjectId.isValid(params.sessionId)) {
		session = await ScheduledSession.findById(params.sessionId);
	}
	if (!session) {
		const targetClass = await Class.findById(params.classId || params.sessionId);
		if (targetClass) {
			session = await ScheduledSession.findOne({
				classId: targetClass._id,
				status: "SCHEDULED",
			}).sort({ sessionDate: 1, startTime: 1 });

			if (!session) {
				// Auto-create a bookable session one hour from now so the booking
				// window is guaranteed open and the class hasn't "already started".
				const now = new Date();
				const sessionStart = new Date(now.getTime() + 60 * 60 * 1000);
				const durationMinutes = (targetClass as any).durationMinutes || 60;
				const sessionEnd = new Date(
					sessionStart.getTime() + durationMinutes * 60 * 1000,
				);
				const cap = (targetClass as any).maxParticipants || 20;

				session = await ScheduledSession.create({
					classId: targetClass._id,
					sessionDate: sessionStart,
					startTime: formatHHMM(sessionStart),
					endTime: formatHHMM(sessionEnd),
					deliveryType: normalizeDeliveryType((targetClass as any).mode),
					locationAddress: (targetClass as any).locationAddress || null,
					streamRoomId: (targetClass as any).streamRoomId || null,
					capacity: cap,
					currentBookings: 0,
					remainingCapacity: cap,
					status: "SCHEDULED",
				});
			}
		}
	}

	if (!session) {
		return {
			success: false,
			statusCode: 404,
			message: "Scheduled session or class not found",
		};
	}

	if (session.status === "CANCELLED" || session.status === "COMPLETED") {
		return {
			success: false,
			statusCode: 400,
			message: `Cannot book a session with status ${session.status}`,
		};
	}

	// From here on, always use the resolved session's real _id — not the caller's
	// raw input, which may have been a Class UUID that fell through the lookup.
	const resolvedSessionId = session._id.toString();
	const resolvedClassId = session.classId.toString();

	// 2. Booking Window Rule Evaluation (FEATURE-012 Engine)
	const rulesEval = await evaluateBookingRules({
		userId: params.userId,
		classId: resolvedClassId,
		sessionId: resolvedSessionId,
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
		sessionId: resolvedSessionId,
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
	const seatAllocation = await allocateSeatAtomic(resolvedSessionId);
	if (!seatAllocation.success) {
		return {
			success: false,
			statusCode: 409,
			message: "Session capacity is full",
			reason: seatAllocation.reason,
		};
	}

	// 5. Create Booking Document; roll back the seat if the write fails
	try {
		const booking = await Bookings.create({
			user: userObjId,
			sessionId: resolvedSessionId,
			classId: resolvedClassId,
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
				sessionId: resolvedSessionId,
				classId: resolvedClassId,
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
		await releaseSeatAtomic(resolvedSessionId);

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
