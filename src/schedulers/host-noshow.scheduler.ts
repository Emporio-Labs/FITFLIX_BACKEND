import {
	CreditTransactionSource,
	CreditTransactionType,
	UnifiedBookingStatus,
} from "../models/Enums";
import CreditTransaction from "../models/CreditTransaction";
import Membership from "../models/Membership";
import UnifiedBooking from "../models/UnifiedBooking";

/**
 * Sweeps every 5 minutes for online 1-on-1 sessions where the host (trainer/expert)
 * failed to start/join the call within 15 minutes of the scheduled start time.
 *
 * CRITICAL SAFETY GUARDS:
 * 1. Uses atomic conditional `findOneAndUpdate` checking `hostLiveAt: null` to eliminate
 *    races with late-joining hosts.
 * 2. Restores member's session quota automatically.
 * 3. Marks `adminResolution.isReversible: true` so admin can reconcile if needed.
 */
export const runHostNoShowSweep = async () => {
	const now = new Date();
	const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

	try {
		const candidateBookings = await UnifiedBooking.find({
			status: UnifiedBookingStatus.CONFIRMED,
			appointmentMode: "ONLINE",
			hostLiveAt: null,
		});

		for (const booking of candidateBookings) {
			const [hours, minutes] = String(booking.startTime).split(":").map(Number);
			const sessionStartDateTime = new Date(booking.bookingDate);
			sessionStartDateTime.setHours(hours || 0, minutes || 0, 0, 0);

			if (sessionStartDateTime.getTime() <= fifteenMinutesAgo.getTime()) {
				// Atomic transition guard
				const updated = await UnifiedBooking.findOneAndUpdate(
					{
						_id: booking._id,
						status: UnifiedBookingStatus.CONFIRMED,
						hostLiveAt: null,
					},
					{
						$set: {
							status: UnifiedBookingStatus.HOST_NO_SHOW,
							hostNoShowAt: now,
							"adminResolution.isReversible": true,
						},
					},
					{ new: true },
				);

				if (updated) {
					console.warn(
						`[HOST_NO_SHOW_DETECTED] Booking ${booking._id.toString()} flagged. Host did not join by ${fifteenMinutesAgo.toISOString()}. Restoring quota.`,
					);

					// Restore quota if credit pool was used
					if (updated.creditCostSnapshot > 0 && updated.packageId) {
						await Membership.findByIdAndUpdate(updated.packageId, {
							$inc: { ptSessionsRemaining: 1, ptSessionsUsed: -1 },
						});

						await CreditTransaction.create({
							user: updated.userId,
							membership: updated.packageId,
							amount: 1,
							type: CreditTransactionType.Refund,
							sourceType: CreditTransactionSource.PersonalTraining,
							sourceId: updated._id,
							actorRole: "system",
							reason: `Automatic quota restore: Host no-show for booking ${updated._id.toString()}`,
						});
					}
				}
			}
		}
	} catch (error) {
		console.error("[HOST_NO_SHOW_SWEEP_ERROR]", error);
	}
};
