/**
 * Pure-function coverage for the timezone layer (utils/timezone.util.ts) and
 * the join window it feeds. No server, no database.
 *
 * These exist because of a production incident: a host could not enter a class
 * scheduled 17:45–18:45 IST, at 17:30, with a 30-minute host lead. The window
 * arithmetic was right; the zone it was resolved in was not. The box read the
 * stored "17:45" as UTC, so the room opened at 22:45 IST and the 403 was a
 * correct answer to a wrong question.
 *
 * Nothing in the codebase noticed, which is the real defect these cover: the
 * checker that would have named it, the normalisation that stops a malformed
 * zone reaching Intl, and a regression assert on the exact session.
 */
import {
	convertZonedTimeToIst,
	formatTimeInZone,
	IST_OFFSET_MINUTES,
	IST_TIMEZONE,
	instantToIstWallClock,
	isValidTimeZone,
	normalizeTimeZone,
	verifyTimeZoneSupport,
} from "../src/utils/timezone.util";
import { buildJoinWindow, combineSessionWindow } from "../src/utils/zego-room";
import { assert } from "./test-helpers";

/** Sessions are written at UTC midnight for the intended calendar day. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function runUnitTests() {
	console.log("\n🔎 A timezone this runtime can actually use");
	{
		assert(isValidTimeZone(IST_TIMEZONE), "Asia/Kolkata is a zone");
		assert(isValidTimeZone("America/New_York"), "so is America/New_York");
		assert(!isValidTimeZone("Mars/Olympus"), "a made-up zone is not");
		assert(!isValidTimeZone(""), "an empty string is not a zone");
		assert(!isValidTimeZone(undefined), "neither is an unset value");
		assert(
			!isValidTimeZone('"Asia/Kolkata"'),
			"nor a value that kept its .env quotes",
		);
	}

	console.log("\n🔎 Normalising what operators and seed data actually write");
	{
		assert(
			normalizeTimeZone("IST") === IST_TIMEZONE,
			'"IST" means Asia/Kolkata, not a fallback to UTC',
		);
		assert(
			normalizeTimeZone("Asia/Calcutta") === IST_TIMEZONE,
			"the old Calcutta spelling maps to the current one",
		);
		assert(
			normalizeTimeZone('"Asia/Kolkata"') === IST_TIMEZONE,
			"a quoted .env value is unwrapped rather than rejected",
		);
		assert(
			normalizeTimeZone("  Asia/Kolkata  ") === IST_TIMEZONE,
			"surrounding whitespace is trimmed",
		);
		assert(
			normalizeTimeZone("America/New_York") === "America/New_York",
			"a real zone is passed through untouched",
		);
		assert(
			normalizeTimeZone("not-a-zone") === IST_TIMEZONE,
			"junk degrades to IST rather than throwing mid-request",
		);
		assert(
			normalizeTimeZone("") === IST_TIMEZONE,
			"and so does an empty value",
		);
		assert(
			normalizeTimeZone("nonsense", "America/New_York") === "America/New_York",
			"the caller's fallback is honoured when one is given",
		);
	}

	console.log("\n🔎 The IST checker");
	{
		const ist = verifyTimeZoneSupport(IST_TIMEZONE);
		assert(ist.ok, "this runtime resolves IST");
		assert(
			ist.actualOffsetMinutes === IST_OFFSET_MINUTES,
			"and resolves it to exactly +05:30",
		);

		// The production failure, as a verdict.
		const utc = verifyTimeZoneSupport("UTC");
		assert(!utc.ok, "a UTC business zone is not silently accepted");
		assert(
			utc.reason === "OFFSET_MISMATCH",
			"and is reported as an offset mismatch, not a bad zone",
		);
		assert(
			utc.actualOffsetMinutes === 0,
			"with the offset it actually resolved to",
		);

		const broken = verifyTimeZoneSupport("Mars/Olympus");
		assert(!broken.ok, "an unresolvable zone fails the check");
		assert(
			broken.reason === "INVALID_ZONE",
			"and is distinguishable from a zone that merely disagrees",
		);

		assert(
			verifyTimeZoneSupport("America/New_York", -300).ok,
			"a non-IST zone passes when that is what the caller expects",
		);
	}

	console.log("\n🔎 Reading an instant back as wall clock");
	{
		// 12:15Z is 17:45 IST.
		const instant = new Date("2026-08-19T12:15:00.000Z");
		assert(
			formatTimeInZone(instant, IST_TIMEZONE) === "17:45",
			"an instant formats to its IST wall clock",
		);

		const wall = instantToIstWallClock(instant);
		assert(wall.date === "2026-08-19", "on the right IST calendar day");
		assert(wall.time === "17:45", "at the right IST time");

		// 20:00Z is past midnight in IST — the day must roll with the clock.
		const late = instantToIstWallClock(new Date("2026-08-19T20:00:00.000Z"));
		assert(
			late.date === "2026-08-20" && late.time === "01:30",
			"and an instant that crosses midnight in IST rolls the day too",
		);
	}

	console.log("\n🔎 Converting another branch's wall clock to IST");
	{
		const ist = convertZonedTimeToIst(day("2026-08-19"), "17:45", IST_TIMEZONE);
		assert(
			ist.instant.toISOString() === "2026-08-19T12:15:00.000Z",
			"17:45 IST is 12:15Z",
		);
		assert(ist.istTime === "17:45", "and reads back as itself");

		// New York is UTC-4 in August, so 09:00 there is 18:30 IST the same day.
		const ny = convertZonedTimeToIst(
			day("2026-08-19"),
			"09:00",
			"America/New_York",
		);
		assert(
			ny.instant.toISOString() === "2026-08-19T13:00:00.000Z",
			"09:00 in New York in August is 13:00Z",
		);
		assert(
			ny.istDate === "2026-08-19" && ny.istTime === "18:30",
			"which is 18:30 IST the same day",
		);
		assert(
			ny.sourceTimeZone === "America/New_York",
			"and the zone actually used is reported back",
		);

		// January: New York is UTC-5, so the same wall clock is a different
		// instant. A fixed offset would get one of these two wrong.
		const winter = convertZonedTimeToIst(
			day("2026-01-19"),
			"09:00",
			"America/New_York",
		);
		assert(
			winter.instant.toISOString() === "2026-01-19T14:00:00.000Z",
			"the same wall clock in January resolves an hour later in UTC",
		);
		assert(
			winter.istTime === "19:30",
			"and lands at 19:30 IST rather than 18:30",
		);

		const junk = convertZonedTimeToIst(
			day("2026-08-19"),
			"17:45",
			"Mars/Olympus",
		);
		assert(
			junk.sourceTimeZone === IST_TIMEZONE,
			"an unusable source zone degrades to IST instead of throwing",
		);
	}

	console.log("\n🔎 Regression: the 17:45 class that refused its own host");
	{
		const HOST_LEAD_MINUTES = 30;
		const at = (utcIso: string) => new Date(utcIso);

		const { startsAt, endsAt } = combineSessionWindow(
			day("2026-08-19"),
			"17:45",
			"18:45",
			IST_TIMEZONE,
		);
		assert(
			startsAt!.toISOString() === "2026-08-19T12:15:00.000Z",
			"a 17:45 class starts at 12:15Z, not 17:45Z",
		);

		const window = buildJoinWindow(
			startsAt!,
			endsAt!,
			"host",
			HOST_LEAD_MINUTES,
		);
		assert(
			window.opensAt.toISOString() === "2026-08-19T11:45:00.000Z",
			"so the host's room opens at 17:15 IST",
		);

		const canJoin = (now: Date) => now.getTime() >= window.opensAt.getTime();
		// 12:00Z = 17:30 IST — the moment the host was refused in production.
		assert(
			canJoin(at("2026-08-19T12:00:00.000Z")),
			"the host may join at 17:30",
		);
		// 12:14Z = 17:44 IST — one minute before the class.
		assert(canJoin(at("2026-08-19T12:14:00.000Z")), "and at 17:44");
		// 10:30Z = 16:00 IST — genuinely too early, and still refused.
		assert(
			!canJoin(at("2026-08-19T10:30:00.000Z")),
			"but not at 16:00, which really is outside the window",
		);

		// The failure this replaces, kept as an assertion so a regression to
		// reading "HH:mm" as UTC fails here rather than in production.
		const misread = combineSessionWindow(
			day("2026-08-19"),
			"17:45",
			"18:45",
			"UTC",
		);
		const misreadWindow = buildJoinWindow(
			misread.startsAt!,
			misread.endsAt!,
			"host",
			HOST_LEAD_MINUTES,
		);
		assert(
			at("2026-08-19T12:00:00.000Z").getTime() <
				misreadWindow.opensAt.getTime(),
			"reading the same class as UTC is what refused the host at 17:30",
		);
		assert(
			(misreadWindow.opensAt.getTime() - window.opensAt.getTime()) / 60_000 ===
				IST_OFFSET_MINUTES,
			"and the gap between the two readings is exactly the IST offset",
		);
	}

	console.log("\n🎉 Timezone Util Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Timezone util test failed:", err);
	process.exit(1);
}
