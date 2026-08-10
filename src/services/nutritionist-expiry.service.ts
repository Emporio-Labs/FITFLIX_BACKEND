import { MeetingStatus, NutritionistBookingStatus } from "../models/Enums";
import NutritionistBooking from "../models/NutritionistBooking";
import Slot from "../models/Slots";
import {
	combineSessionDateTime,
	NUTRI_EXPIRY_GRACE_MINUTES,
} from "../utils/zego-room";

/**
 * Two independent staleness rules for nutritionist bookings, both terminal.
 *
 * 1. PENDING past its *start* time, zero grace: the admin never accepted, so
 *    the booking becomes RESCHEDULE_REQUIRED and the slot's capacity is
 *    released so it can be reused. No credits are involved.
 *
 * 2. ACCEPTED past its *end* time plus NUTRI_EXPIRY_GRACE_MINUTES: the
 *    appointment was confirmed but the meeting never happened (the
 *    nutritionist never hosted it, and nothing marked the session complete),
 *    so it becomes EXPIRED. The slot seat is NOT released here — unlike rule
 *    1, an accepted appointment genuinely consumed it.
 *
 * Both rules write status and nothing else: bookingDate, startTime, endTime,
 * zegoRoomId and acceptedAt are left exactly as they were, so an expired
 * booking stays a faithful historical record.
 *
 * Called from processReminders(). Per-row try/catch keeps one bad document
 * from halting the sweep.
 */
export async function expireStaleNutritionistBookings(
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
				{ $set: { status: NutritionistBookingStatus.RESCHEDULE_REQUIRED } },
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

	// Rule 2: ACCEPTED bookings whose scheduled end (plus grace) has passed
	// without the meeting ever taking place.
	const graceMs = NUTRI_EXPIRY_GRACE_MINUTES * 60_000;

	const accepted = await NutritionistBooking.find({
		status: NutritionistBookingStatus.ACCEPTED,
	})
		.limit(500)
		.lean();

	for (const row of accepted) {
		try {
			// A session that actually ran is history, not a miss — never reopen it.
			if (row.meetingStatus === MeetingStatus.COMPLETED) {
				continue;
			}

			const endInstant = combineSessionDateTime(row.bookingDate, row.endTime);
			if (!endInstant) {
				continue; // no usable end time — leave it alone rather than guess
			}
			if (endInstant.getTime() + graceMs >= now.getTime()) {
				continue; // still inside the appointment window or its grace period
			}

			// Atomic status transition — a concurrent complete/cancel/reject wins.
			const claimed = await NutritionistBooking.findOneAndUpdate(
				{ _id: row._id, status: NutritionistBookingStatus.ACCEPTED },
				{ $set: { status: NutritionistBookingStatus.EXPIRED } },
				{ returnDocument: "after" },
			);
			if (!claimed) {
				skipped++;
				continue;
			}

			expired++;
		} catch (err) {
			console.error(
				`[nutritionist-expiry] Failed to expire accepted booking ${String(row._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { expired, skipped };
}
