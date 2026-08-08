/**
 * Pure-function coverage for the occurrence-based room lifecycle
 * (utils/zego-room.ts). No server, no database — these are arithmetic and
 * string derivations, so they run in milliseconds and can't be flaky.
 */
import {
	buildJoinWindow,
	buildRoomTimeline,
	combineSessionDateTime,
	deriveRoomId,
	resolveSessionRoomId,
	ROOM_EXPIRY_GRACE_MINUTES,
	ROOM_LEAD_MINUTES,
} from "../src/utils/zego-room";
import { assert } from "./test-helpers";

function runUnitTests() {
	console.log("=== Unit Test: Occurrence Room Lifecycle (zego-room.ts) ===");

	console.log("\n1. buildRoomTimeline / buildJoinWindow — 7:00-8:00 PM IST session...");
	{
		// sessionDate is stored at UTC midnight; combineSessionDateTime is what
		// interprets "19:00" as IST wall-clock, exactly as ScheduledSession rows
		// are read in production.
		const sessionDate = new Date("2026-08-10T00:00:00.000Z");
		const start = combineSessionDateTime(sessionDate, "19:00")!;
		const end = combineSessionDateTime(sessionDate, "20:00")!;
		assert(start !== null, "start parses");
		assert(end !== null, "end parses");

		// 19:00 IST == 13:30 UTC
		assert(
			start.toISOString() === "2026-08-10T13:30:00.000Z",
			"7:00 PM IST resolves to 13:30 UTC",
		);

		const timeline = buildRoomTimeline(start, end);
		assert(
			timeline.roomReadyAt.toISOString() === "2026-08-10T13:00:00.000Z",
			"roomReadyAt is start - 30m (6:30 PM IST)",
		);
		assert(
			timeline.memberOpensAt.toISOString() === "2026-08-10T13:25:00.000Z",
			"memberOpensAt is start - 5m (6:55 PM IST)",
		);
		assert(
			timeline.memberClosesAt.getTime() === end.getTime(),
			"memberClosesAt is exactly the scheduled end (8:00 PM IST) — zero grace",
		);
		assert(
			timeline.roomExpiresAt.toISOString() === "2026-08-10T15:00:00.000Z",
			"roomExpiresAt is end + 30m (8:30 PM IST) — matches the spec's example",
		);

		const hostWindow = buildJoinWindow(start, end, "host");
		assert(
			hostWindow.opensAt.getTime() === timeline.roomReadyAt.getTime(),
			"host window opens at roomReadyAt",
		);
		assert(
			hostWindow.closesAt.getTime() === timeline.roomExpiresAt.getTime(),
			"host window closes at roomExpiresAt — host may stay until the room itself expires",
		);

		const memberWindow = buildJoinWindow(start, end, "member");
		assert(
			memberWindow.opensAt.getTime() === timeline.memberOpensAt.getTime(),
			"member window opens at memberOpensAt",
		);
		assert(
			memberWindow.closesAt.getTime() === end.getTime(),
			"member window closes exactly at scheduled end, not at roomExpiresAt",
		);
	}

	console.log("\n2. Per-class occurrenceLeadMinutes override...");
	{
		const start = new Date("2026-08-10T13:30:00.000Z");
		const end = new Date("2026-08-10T14:30:00.000Z");
		const timeline = buildRoomTimeline(start, end, 45);
		assert(
			timeline.roomReadyAt.getTime() === start.getTime() - 45 * 60_000,
			"a class-level lead override shifts roomReadyAt, not the member window",
		);
		assert(
			timeline.memberOpensAt.getTime() === start.getTime() - 5 * 60_000,
			"member lead stays fixed at 5 minutes regardless of the class override",
		);
	}

	console.log("\n3. IST/UTC date-boundary case — 11:30 PM IST class...");
	{
		// 23:30 IST on Aug 10 is 18:00 UTC on Aug 10 — still the same UTC day,
		// but this is the boundary case that has bitten naive local-Date() math
		// elsewhere in this codebase (see live-session.service.ts's frontdesk
		// comment on the same drift). Assert combineSessionDateTime gets it right.
		const sessionDate = new Date("2026-08-10T00:00:00.000Z");
		const start = combineSessionDateTime(sessionDate, "23:30")!;
		assert(
			start.toISOString() === "2026-08-10T18:00:00.000Z",
			"11:30 PM IST resolves to 18:00 UTC on the same UTC calendar day",
		);

		// A class starting at 00:15 IST — before UTC midnight rolls to the same
		// day — is where the offset actually pushes the UTC date backward.
		const start2 = combineSessionDateTime(sessionDate, "00:15")!;
		assert(
			start2.toISOString() === "2026-08-09T18:45:00.000Z",
			"12:15 AM IST resolves to 18:45 UTC on the PREVIOUS UTC calendar day",
		);
	}

	console.log("\n4. Unparseable schedule fails closed with a bounded window, not open-ended...");
	{
		const start = new Date("2026-08-10T13:30:00.000Z");
		const timeline = buildRoomTimeline(start, null);
		assert(
			timeline.memberClosesAt.getTime() === start.getTime() + 60 * 60_000,
			"missing end defaults to start + 60m rather than staying unbounded",
		);
	}

	console.log("\n5. resolveSessionRoomId — the regression test for the streamRoomId collision...");
	{
		const sessionId = "64b7f9f1c2a4e5f6a7b8c9d0";

		const withStoredId = resolveSessionRoomId({ _id: sessionId, videoRoomId: "custom_room_123" });
		assert(withStoredId === "custom_room_123", "an explicitly stored videoRoomId is returned as-is (sanitized)");

		const withoutStoredId = resolveSessionRoomId({ _id: sessionId, videoRoomId: null });
		assert(
			withoutStoredId === deriveRoomId(sessionId),
			"a null videoRoomId derives deterministically from the session id",
		);

		// This is the exact bug this whole change fixes: streamRoomId holds a
		// Zego *layout template*, and it must never influence room identity —
		// resolveSessionRoomId doesn't even accept it as an argument, so there
		// is no code path left that could fall back to it.
		const otherSessionId = "64b7f9f1c2a4e5f6a7b8c9d1";
		const roomA = resolveSessionRoomId({ _id: sessionId, videoRoomId: null });
		const roomB = resolveSessionRoomId({ _id: otherSessionId, videoRoomId: null });
		assert(
			roomA !== roomB,
			"two different sessions never resolve to the same room, even with identical (absent) videoRoomId",
		);

		const asStringRef = resolveSessionRoomId(sessionId);
		assert(
			asStringRef === deriveRoomId(sessionId),
			"an un-populated string ref resolves identically to the populated-doc form",
		);

		assert(resolveSessionRoomId(null) === null, "a null session resolves to no room");
		assert(resolveSessionRoomId(undefined) === null, "an undefined session resolves to no room");
	}

	console.log("\n6. deriveRoomId is stable under sanitizeRoomId...");
	{
		const id = "64b7f9f1c2a4e5f6a7b8c9d0";
		const derived = deriveRoomId(id);
		assert(derived === `gc_${id}`, "derived room id is the gc_ prefix plus the raw id (already URL-safe)");
		assert(
			deriveRoomId(id) === deriveRoomId(id),
			"deriveRoomId is deterministic across calls",
		);
	}

	console.log(`\n(config: ROOM_LEAD_MINUTES=${ROOM_LEAD_MINUTES}, ROOM_EXPIRY_GRACE_MINUTES=${ROOM_EXPIRY_GRACE_MINUTES})`);
	console.log("\n🎉 Occurrence Room Lifecycle Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Session room lifecycle unit test failed:", err);
	process.exit(1);
}
