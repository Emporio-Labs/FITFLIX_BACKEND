import { NutritionistBookingStatus } from "../models/Enums";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import { combineSessionDateTime } from "../utils/zego-room";

/**
 * Auto-expire PENDING nutritionist bookings whose appointment start time has
 * already passed in business timezone. The user's approved policy: if the
 * admin has not accepted by the moment the appointment was supposed to begin,
 * the booking is expired and the slot's capacity is released so it can be
 * reused. No credits are involved.
 *
 * Called from processReminders() every 60s. Per-row try/catch keeps one bad
 * document from halting the sweep.
 */
export async function expireStalePendingBookings(
	now: Date = new Date(),
): Promise<{ expired: number; skipped: number }> {
	let expired = 0;
	let skipped = 0;

	// Fetch all PENDING rows and filter in-memory: startTime is stored as a
	// business-tz "HH:mm" string, so combineSessionDateTime is what maps the
	// (bookingDate, startTime) pair to a real UTC instant we can compare.
	const pending = await NutritionistBooking.find({
		status: NutritionistBookingStatus.PENDING,
	})
		.limit(500)
		.lean();

	for (const row of pending) {
		try {
			const startInstant = combineSessionDateTime(row.bookingDate, row.startTime);
			if (!startInstant || startInstant.getTime() > now.getTime()) {
				continue; // still in the future — leave it PENDING
			}

			// Atomic status transition — guard against a concurrent accept.
			const claimed = await NutritionistBooking.findOneAndUpdate(
				{ _id: row._id, status: NutritionistBookingStatus.PENDING },
				{ $set: { status: NutritionistBookingStatus.EXPIRED } },
				{ returnDocument: "after" },
			);
			if (!claimed) {
				skipped++;
				continue;
			}

			// Release the held slot seat, mirroring rejectBooking. Best-effort:
			// if this fails we still want the status transition to stick.
			if (row.slotId) {
				try {
					await Slot.findByIdAndUpdate(row.slotId, {
						$inc: { remainingCapacity: 1 },
						$set: { isBooked: false },
					});
				} catch (err) {
					console.error(
						`[nutritionist-expiry] Slot release failed for booking ${String(row._id)}`,
						err,
					);
				}
			}

			expired++;
		} catch (err) {
			console.error(
				`[nutritionist-expiry] Failed to expire booking ${String(row._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { expired, skipped };
}
