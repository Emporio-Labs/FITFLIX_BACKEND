import Bookings from "../models/Bookings";
import { CreditTransactionSource } from "../models/Enums";
import ScheduledSession from "../models/ScheduledSession";
import { refundCreditsBySource } from "../utils/credit.service";
import { releaseSeatAtomic } from "./capacity-engine.service";

export interface CancellationResult {
	success: boolean;
	statusCode?: 200 | 400 | 403 | 404 | 500;
	message?: string;
	refunded?: boolean;
	latePenaltyApplied?: boolean;
	creditRefunded?: number;
	booking?: any;
}

export async function cancelBooking(params: {
	bookingId: string;
	requesterId: string;
	requesterRole: string;
	adminOverride?: boolean;
	now?: Date;
}): Promise<CancellationResult> {
	const now = params.now || new Date();

	const booking = await Bookings.findById(params.bookingId);
	if (!booking) {
		return {
			success: false,
			statusCode: 404,
			message: "Booking not found",
		};
	}

	if (
		params.requesterRole === "user" &&
		booking.user.toString() !== params.requesterId
	) {
		return {
			success: false,
			statusCode: 403,
			message: "Forbidden: You cannot cancel another member's booking",
		};
	}

	if (
		booking.status === "Cancelled" ||
		booking.status === "CANCELLED" ||
		(booking as any).status === 2
	) {
		return {
			success: false,
			statusCode: 400,
			message: "Booking is already cancelled",
		};
	}

	let sessionStartDateTime = new Date(booking.bookingDate);
	if (booking.startTime) {
		const [hours, minutes] = String(booking.startTime).split(":").map(Number);
		sessionStartDateTime.setHours(hours, minutes, 0, 0);
	}

	if (booking.sessionId) {
		const session = await ScheduledSession.findById(booking.sessionId).lean();
		if (session) {
			const [hours, minutes] = String(session.startTime).split(":").map(Number);
			sessionStartDateTime = new Date(session.sessionDate);
			sessionStartDateTime.setHours(hours, minutes, 0, 0);
		}
	}

	const msUntilStart = sessionStartDateTime.getTime() - now.getTime();
	const hoursUntilStart = msUntilStart / (1000 * 60 * 60);

	const isEarlyCancellation = hoursUntilStart >= 24;
	const isAdminOverride =
		params.requesterRole === "admin" && Boolean(params.adminOverride);
	const shouldRefundCredits = isEarlyCancellation || isAdminOverride;

	booking.status = "Cancelled";
	await booking.save();

	if (booking.sessionId) {
		await releaseSeatAtomic(booking.sessionId);
	}

	let creditRefunded = 0;

	const creditCost = typeof booking.creditCostSnapshot === "number" ? booking.creditCostSnapshot : 1;
	const isFreeOrBypassed = creditCost === 0 || Boolean(booking.creditsBypassed);

	if (shouldRefundCredits && !isFreeOrBypassed) {
		try {
			await refundCreditsBySource({
				userId: booking.user.toString(),
				sourceType: CreditTransactionSource.Booking,
				sourceId: booking._id.toString(),
				actorId: params.requesterId,
				actorRole: params.requesterRole as any,
				reason: isAdminOverride
					? `Admin override refund for cancelled booking ${booking._id.toString()}`
					: `Early cancellation refund for booking ${booking._id.toString()}`,
			});
			creditRefunded = creditCost;
		} catch (error) {
			console.warn("[CANCELLATION_REFUND_NOTICE]", error);
		}
	}

	return {
		success: true,
		statusCode: 200,
		message: shouldRefundCredits
			? "Booking cancelled successfully. Credits refunded."
			: "Late cancellation policy applied: seat released, credits forfeited.",
		refunded: shouldRefundCredits,
		latePenaltyApplied: !shouldRefundCredits,
		creditRefunded,
		booking: {
			id: booking._id.toString(),
			status: booking.status,
			refunded: shouldRefundCredits,
			cancelledAt: new Date(),
		},
	};
}
