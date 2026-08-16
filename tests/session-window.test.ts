/**
 * Pure-function coverage for combineSessionWindow (utils/zego-room.ts).
 * No server, no database.
 *
 * A session is stored as one date plus two "HH:mm" strings. Composing both
 * against that same date resolves a 23:30–00:30 booking to an end 23 hours
 * before its own start, which closed the join window before it opened and
 * refused a member the room their session was about to start in.
 *
 * These assert instants rather than shapes, because the failure mode is
 * arithmetic: a window that is structurally fine and semantically inverted.
 */
import { combineSessionDateTime, combineSessionWindow } from "../src/utils/zego-room";
import { assert } from "./test-helpers";

/** Sessions are written at UTC midnight for the intended calendar day. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

function runUnitTests() {
	console.log("\n🔎 A session that runs past midnight");
	{
		const { startsAt, endsAt } = combineSessionWindow(
			day("2026-08-16"),
			"23:30",
			"00:30",
		);

		assert(!!startsAt && !!endsAt, "both ends resolve");
		assert(
			endsAt!.getTime() > startsAt!.getTime(),
			"the end is after the start, not 23 hours before it",
		);
		assert(
			minutesBetween(startsAt!, endsAt!) === 60,
			"the window is the hour it was booked for",
		);
		assert(
			endsAt!.getTime() ===
				combineSessionDateTime(day("2026-08-17"), "00:30")!.getTime(),
			"the end lands on the following calendar day, in business time",
		);
	}

	console.log("\n🔎 An ordinary same-day session is untouched");
	{
		const { startsAt, endsAt } = combineSessionWindow(
			day("2026-08-16"),
			"10:00",
			"11:00",
		);

		assert(
			minutesBetween(startsAt!, endsAt!) === 60,
			"a daytime window keeps its length",
		);
		assert(
			endsAt!.getTime() ===
				combineSessionDateTime(day("2026-08-16"), "11:00")!.getTime(),
			"and does not gain a day it should not have",
		);
	}

	console.log("\n🔎 Degenerate and malformed input");
	{
		// Equal times are not a zero-length session anybody booked; treating
		// them as a full day is the same call PtBooking.joinGate makes.
		const equal = combineSessionWindow(day("2026-08-16"), "09:00", "09:00");
		assert(
			minutesBetween(equal.startsAt!, equal.endsAt!) === 24 * 60,
			"an equal start and end wraps rather than collapsing to nothing",
		);

		const midnightEnd = combineSessionWindow(day("2026-08-16"), "22:00", "00:00");
		assert(
			minutesBetween(midnightEnd.startsAt!, midnightEnd.endsAt!) === 120,
			"an end at exactly midnight belongs to the next day",
		);

		assert(
			combineSessionWindow(day("2026-08-16"), "bad", "00:30").startsAt === null,
			"an unparseable start resolves to null, so callers fail closed",
		);
		assert(
			combineSessionWindow(day("2026-08-16"), "23:30", "bad").endsAt === null,
			"an unparseable end resolves to null rather than being wrapped",
		);
		assert(
			combineSessionWindow(null, "23:30", "00:30").startsAt === null,
			"a missing date resolves to null",
		);
	}

	console.log("\n🔎 Month and year boundaries");
	{
		const monthEnd = combineSessionWindow(day("2026-08-31"), "23:30", "00:30");
		assert(
			monthEnd.endsAt!.getTime() ===
				combineSessionDateTime(day("2026-09-01"), "00:30")!.getTime(),
			"the last night of a month rolls into the next month",
		);

		const yearEnd = combineSessionWindow(day("2026-12-31"), "23:30", "00:30");
		assert(
			yearEnd.endsAt!.getTime() ===
				combineSessionDateTime(day("2027-01-01"), "00:30")!.getTime(),
			"new year's eve rolls into the next year",
		);
	}

	console.log("\n🎉 Session Window Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Session window unit test failed:", err);
	process.exit(1);
}
