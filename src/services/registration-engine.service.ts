import mongoose from "mongoose";
import Bookings from "../models/Bookings";
import Class from "../models/Class";
import { CreditTransactionSource } from "../models/Enums";
import ScheduledSession from "../models/ScheduledSession";
import {
	CreditServiceError,
	consumeCredits,
	mapCreditServiceError,
	refundCreditsBySource,
} from "../utils/credit.service";
import { evaluateBookingRules } from "./booking-rules-engine.service";
import { allocateSeatAtomic, releaseSeatAtomic } from "./capacity-engine.service";

import { syncSessionsForClass } from "../controllers/class.controller";

export interface GroupClassRegistrationResult {
	success: boolean;
	statusCode?: 201 | 400 | 402 | 403 | 404 | 409 | 500;
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
	//    The caller may pass a real ScheduledSession _id (ObjectId) or a Class _id
	//    (randomUUID string). Try the session lookup first; if that fails, resolve
	//    the class and pick its next upcoming session — never fabricate a session
	//    from `now`, because the admin's configured time on `Class.scheduleInfo` is
	//    the source of truth (materialized by syncSessionsForClass).
	let session: any = null;
	if (mongoose.Types.ObjectId.isValid(params.sessionId)) {
		session = await ScheduledSession.findById(params.sessionId);
	}
	if (!session) {
		const targetClass = await Class.findById(params.classId || params.sessionId);
		if (
			targetClass &&
			((targetClass as any).status === "INACTIVE" ||
				(targetClass as any).isPublished === false)
		) {
			// Bail out before syncSessionsForClass below, which would otherwise
			// re-materialize sessions for a retired class and re-populate the
			// member feed we just filtered in getSchedulesForMembers.
			return {
				success: false,
				statusCode: 403,
				message: "This class is no longer available for booking",
			};
		}
		if (targetClass) {
			const todayStart = new Date();
			todayStart.setUTCHours(0, 0, 0, 0);
			session = await ScheduledSession.findOne({
				classId: targetClass._id,
				status: "SCHEDULED",
				sessionDate: { $gte: todayStart },
			}).sort({ sessionDate: 1, startTime: 1 });

			if (!session) {
				// Auto-materialize scheduled sessions for classes whose schedule was updated
				await syncSessionsForClass(targetClass);
				session = await ScheduledSession.findOne({
					classId: targetClass._id,
					status: "SCHEDULED",
					sessionDate: { $gte: todayStart },
				}).sort({ sessionDate: 1, startTime: 1 });

				if (!session) {
					session = await ScheduledSession.findOne({
						classId: targetClass._id,
						status: "SCHEDULED",
					}).sort({ sessionDate: 1, startTime: 1 });
				}
			}
		}
	}

	if (!session) {
		return {
			success: false,
			statusCode: 404,
			message:
				"No upcoming session is scheduled for this class. Ask an admin to publish a schedule.",
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

	// The class doc is loaded unconditionally so step 5 can charge the member
	// the real creditCost rather than the previous hardcoded `1`.
	const targetClass = await Class.findById(resolvedClassId);
	const isFree =
		(targetClass as any)?.bookingRequirement === "free" ||
		Number((targetClass as any)?.creditCost) === 0;
	const creditCost = isFree ? 0 : Number((targetClass as any)?.creditCost) || 1;

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

	// 5. Atomic Credit Deduction (FEATURE-013 Engine)
	//    Runs *after* the seat is reserved but *before* the booking row is
	//    written, so a member with an empty wallet loses only the transient
	//    seat lock we roll back below — never a partially-written booking.
	if (creditCost > 0) {
		// consumeCredits pools across every active package oldest-expiry-first.
		// The previous consumeCreditsAtomic deducted from a single membership,
		// so a member holding two packages could be refused for insufficient
		// credits while having plenty spread across both.
		try {
			await consumeCredits({
				userId: params.userId,
				amount: creditCost,
				sourceType: CreditTransactionSource.Booking,
				sourceId: resolvedSessionId,
				reason: `Group class booking ${resolvedClassId}`,
				locationId: session.locationId ? String(session.locationId) : undefined,
			});
		} catch (error) {
			await releaseSeatAtomic(resolvedSessionId);

			if (error instanceof CreditServiceError) {
				const mapped = mapCreditServiceError(error);
				return {
					success: false,
					// 402 for an empty wallet, 404 when there's no membership at
					// all; anything else is a bad request.
					statusCode:
						mapped.status === 402 ? 402 : mapped.status === 404 ? 404 : 400,
					message: mapped.message,
					reason: error.code,
				};
			}

			throw error;
		}
	}

	// 6. Create Booking Document; roll back the seat AND refund the credits
	//    if the write fails, so a Mongo error can't leave the member out of
	//    pocket with nothing to show for it.
	try {
		const booking = await Bookings.create({
			user: userObjId,
			sessionId: resolvedSessionId,
			classId: resolvedClassId,
			bookingDate: session.sessionDate,
			startTime: session.startTime,
			endTime: session.endTime,
			status: "Confirmed",
			creditCostSnapshot: creditCost,
			creditsBypassed: false,
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
		await releaseSeatAtomic(resolvedSessionId);
		try {
			await refundCreditsBySource({
				userId: params.userId,
				sourceType: CreditTransactionSource.Booking,
				sourceId: resolvedSessionId,
				reason: `Rollback: booking write failed for session ${resolvedSessionId}`,
			});
		} catch (refundError) {
			console.warn(
				"[REGISTRATION_ROLLBACK_REFUND_FAILED]",
				resolvedSessionId,
				refundError,
			);
		}

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
