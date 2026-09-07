import { MeetingStatus, UnifiedBookingStatus } from "../models/Enums";
import UnifiedBooking from "../models/UnifiedBooking";
import { SPORTS_SCIENTIST_BOOKING_FILTER } from "../utils/sports-scientist-booking.dto";
import {
	combineSessionDateTime,
	SPORTS_SCIENTIST_EXPIRY_GRACE_MINUTES,
} from "../utils/zego-room";
import { releaseSlotCapacity } from "./slot-reservation.service";

/**
 * Mirrors nutritionist-expiry.service.ts's two staleness rules, both terminal,
 * for sports-scientist consultations now that they live in `UnifiedBooking`
 * too (see utils/sports-scientist-booking.dto.ts). `ExpertAppointment` had no
 * expiry sweep of its own — a stale sports-scientist booking simply sat as
 * PENDING or CONFIRMED forever — so this is new coverage, not a port of
 * existing behaviour.
 *
 * 1. PENDING past its *start* time, zero grace: the admin never accepted, so
 *    the booking becomes RESCHEDULE_REQUIRED and the slot's capacity is
 *    released so it can be reused.
 *
 * 2. CONFIRMED past its *end* time plus SPORTS_SCIENTIST_EXPIRY_GRACE_MINUTES:
 *    the appointment was confirmed but the meeting never happened, so it
 *    becomes EXPIRED. The slot seat is NOT released here — unlike rule 1, an
 *    accepted appointment genuinely consumed it.
 *
 * Both rules write status and nothing else: bookingDate, startTime, endTime,
 * zegoRoomId and acceptedAt are left exactly as they were, so an expired
 * booking stays a faithful historical record.
 *
 * Called from processReminders(). Per-row try/catch keeps one bad document
 * from halting the sweep.
 */
export async function expireStaleSportsScientistBookings(
	now: Date = new Date(),
): Promise<{ expired: number; skipped: number }> {
	let expired = 0;
	let skipped = 0;

	// Fetch all PENDING rows and filter in-memory: startTime is stored as a
	// business-tz "HH:mm" string, so combineSessionDateTime is what maps the
	// (bookingDate, startTime) pair to a real UTC instant we can compare.
	const pending = await UnifiedBooking.find({
		...SPORTS_SCIENTIST_BOOKING_FILTER,
		status: UnifiedBookingStatus.PENDING,
	})
		.limit(500)
		.lean();

	for (const row of pending) {
		try {
			const startInstant = combineSessionDateTime(
				row.bookingDate,
				row.startTime,
			);
			if (!startInstant || startInstant.getTime() > now.getTime()) {
				continue; // still in the future — leave it PENDING
			}

			// Atomic status transition — guard against a concurrent accept.
			const claimed = await UnifiedBooking.findOneAndUpdate(
				{ _id: row._id, status: UnifiedBookingStatus.PENDING },
				{ $set: { status: UnifiedBookingStatus.RESCHEDULE_REQUIRED } },
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
					await releaseSlotCapacity(row.slotId.toString());
				} catch (err) {
					console.error(
						`[sports-scientist-expiry] Slot release failed for booking ${String(row._id)}`,
						err,
					);
				}
			}

			expired++;
		} catch (err) {
			console.error(
				`[sports-scientist-expiry] Failed to expire booking ${String(row._id)}`,
				err,
			);
			skipped++;
		}
	}

	// Rule 2: CONFIRMED bookings whose scheduled end (plus grace) has passed
	// without the meeting ever taking place.
	const graceMs = SPORTS_SCIENTIST_EXPIRY_GRACE_MINUTES * 60_000;

	const confirmed = await UnifiedBooking.find({
		...SPORTS_SCIENTIST_BOOKING_FILTER,
		status: UnifiedBookingStatus.CONFIRMED,
	})
		.limit(500)
		.lean();

	for (const row of confirmed) {
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
			const claimed = await UnifiedBooking.findOneAndUpdate(
				{ _id: row._id, status: UnifiedBookingStatus.CONFIRMED },
				{ $set: { status: UnifiedBookingStatus.EXPIRED } },
				{ returnDocument: "after" },
			);
			if (!claimed) {
				skipped++;
				continue;
			}

			expired++;
		} catch (err) {
			console.error(
				`[sports-scientist-expiry] Failed to expire confirmed booking ${String(row._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { expired, skipped };
}
