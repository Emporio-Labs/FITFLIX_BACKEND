/**
 * DST coverage for combineSessionDateTime / combineSessionWindow.
 *
 * Run against America/New_York rather than the production BUSINESS_TIMEZONE,
 * because Asia/Kolkata has no daylight saving — which is exactly why none of
 * the offset machinery in zego-room.ts has ever actually been exercised. The
 * two-pass offset resolution and the midnight wrap's re-entry with the next
 * calendar date both exist for this, and both were untested.
 *
 * This is not hypothetical: the moment a club opens outside India, or
 * BUSINESS_TIMEZONE is pointed anywhere with DST, these paths go live.
 *
 *   BUSINESS_TIMEZONE=America/New_York bun run tests/session-window-dst.test.ts
 */
import { combineSessionDateTime, combineSessionWindow, BUSINESS_TIMEZONE } from "../src/utils/zego-room";
import { assert } from "./test-helpers";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const utc = (d: Date | null) => d!.toISOString();
const hoursBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 3_600_000;

// 2026 US transitions: forward Sun 8 Mar (02:00 EST → 03:00 EDT),
// back Sun 1 Nov (02:00 EDT → 01:00 EST).
const SPRING_FORWARD = "2026-03-08";
const FALL_BACK = "2026-11-01";

function runUnitTests() {
	assert(
		BUSINESS_TIMEZONE === "America/New_York",
		"the suite is running against a DST zone (set BUSINESS_TIMEZONE)",
	);

	console.log("\n🔎 The same wall clock is a different instant either side of a transition");
	{
		// This is the whole reason combineSessionDateTime resolves the offset
		// twice rather than assuming a fixed one.
		assert(
			utc(combineSessionDateTime(day("2026-01-15"), "10:00")) ===
				"2026-01-15T15:00:00.000Z",
			"10:00 in winter is 15:00Z (UTC-5)",
		);
		assert(
			utc(combineSessionDateTime(day("2026-07-15"), "10:00")) ===
				"2026-07-15T14:00:00.000Z",
			"10:00 in summer is 14:00Z (UTC-4)",
		);
		assert(
			combineSessionDateTime(day("2026-01-15"), "10:00")!.getTime() !==
				combineSessionDateTime(day("2026-07-15"), "10:00")!.getTime() -
					182 * 24 * 3_600_000,
			"a fixed offset would have put these an exact number of days apart",
		);
	}

	console.log("\n🔎 A session spanning the spring-forward gap");
	{
		// 01:00 → 04:00 is three hours on the wall and two in real time: 02:00
		// never happens. A room whose TTL trusted the wall clock would stay
		// open an hour past its own end.
		const { startsAt, endsAt } = combineSessionWindow(
			day(SPRING_FORWARD),
			"01:00",
			"04:00",
		);
		assert(
			hoursBetween(startsAt!, endsAt!) === 2,
			"three wall-clock hours across the gap are two real ones",
		);
		assert(
			endsAt!.getTime() > startsAt!.getTime(),
			"and the window still runs forwards",
		);
	}

	console.log("\n🔎 A session spanning the fall-back repeat");
	{
		// 01:00 → 03:00 is two hours on the wall and three in real time: 01:00
		// to 02:00 happens twice.
		const { startsAt, endsAt } = combineSessionWindow(
			day(FALL_BACK),
			"01:00",
			"03:00",
		);
		assert(
			hoursBetween(startsAt!, endsAt!) === 3,
			"two wall-clock hours across the repeat are three real ones",
		);
	}

	console.log("\n🔎 The midnight wrap still holds across a transition");
	{
		// The night before the clocks go forward. The wrap re-enters
		// combineSessionDateTime with the next calendar date, so the end is
		// resolved on the day it actually falls on rather than by adding a
		// fixed 24 hours to the start.
		const eve = combineSessionWindow(day("2026-03-07"), "23:30", "00:30");
		assert(
			eve.endsAt!.getTime() > eve.startsAt!.getTime(),
			"the night before spring forward still ends after it starts",
		);
		assert(
			hoursBetween(eve.startsAt!, eve.endsAt!) === 1,
			"and is still the hour it was booked for",
		);

		const backEve = combineSessionWindow(day("2026-10-31"), "23:30", "00:30");
		assert(
			hoursBetween(backEve.startsAt!, backEve.endsAt!) === 1,
			"the night before the clocks go back behaves the same",
		);

		// A long overnight session that genuinely contains the transition:
		// 22:00 on transition eve through 06:00 the next morning is eight wall
		// hours and seven real ones.
		const through = combineSessionWindow(day("2026-03-07"), "22:00", "06:00");
		assert(
			hoursBetween(through.startsAt!, through.endsAt!) === 7,
			"an overnight session containing the gap loses the skipped hour",
		);
	}

	console.log("\n🔎 The transition day itself is still an ordinary day");
	{
		const { startsAt, endsAt } = combineSessionWindow(
			day(SPRING_FORWARD),
			"10:00",
			"11:00",
		);
		assert(
			hoursBetween(startsAt!, endsAt!) === 1,
			"a class after the change is a normal hour",
		);
		assert(
			utc(startsAt) === "2026-03-08T14:00:00.000Z",
			"and resolves at the post-transition offset (UTC-4)",
		);
	}

	console.log("\n🎉 Session Window DST Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Session window DST test failed:", err);
	process.exit(1);
}
