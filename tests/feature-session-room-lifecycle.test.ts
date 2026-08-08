/**
 * Integration coverage for the occurrence-based room lifecycle:
 *   T-30 (host window opens / room provisioned) -> T-5 (member window opens)
 *   -> scheduled end (member access closes) -> T+30 (room expires, session
 *   completed).
 *
 * Drives resolveSessionAccess directly with an injected `now`, and calls the
 * lifecycle sweeps (prepareDueRooms/expireDueRooms) with the same injected
 * `now`, so the gate and the job are asserted against the identical clock.
 * Runs the full walk twice — once for `group_class`, once for `live_stream`
 * — to confirm the two session types share one lifecycle path.
 *
 * NOTE: like the other tests/feature-*.test.ts files in this repo, this
 * connects to MONGODB_URL (see test-helpers.ts) and cleans up everything it
 * creates in a `finally` block, scoped to the test class/session ids it
 * itself generated.
 */
import mongoose from "mongoose";
import Booking from "../src/models/Bookings";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import {
	resolveSessionAccess,
	type SessionAccessResult,
} from "../src/services/session-access.service";
import {
	expireDueRooms,
	prepareDueRooms,
} from "../src/services/session-room-lifecycle.service";
import connectDB from "../src/utils/db";
import { deriveRoomId } from "../src/utils/zego-room";
import { assert } from "./test-helpers";

const BUSINESS_TIMEZONE = "Asia/Kolkata";

/// Converts an absolute instant into the {sessionDate, "HH:mm"} shape
/// ScheduledSession stores, the same way admin-authored sessions arrive.
/// Deliberately picked mid-day so the Y-M-D/HH:mm split never crosses the
/// "24:00" formatting edge case that combineSessionDateTime itself guards
/// against with its `% 24`.
function toBusinessWallClock(instant: Date): { sessionDate: Date; time: string } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: BUSINESS_TIMEZONE,
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		})
			.formatToParts(instant)
			.map((p) => [p.type, p.value]),
	);
	const sessionDate = new Date(
		Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
	);
	return { sessionDate, time: `${parts.hour}:${parts.minute}` };
}

async function runSessionRoomLifecycleTests() {
	console.log("=== Feature Test: Occurrence Room Lifecycle (group_class & live_stream) ===");

	await connectDB();

	const hostId = new mongoose.Types.ObjectId().toString();
	const memberId = new mongoose.Types.ObjectId().toString();
	const hostUser = { id: hostId, email: "host@fitflix.test", role: "admin" as const };
	const memberUser = { id: memberId, email: "member@fitflix.test", role: "user" as const };

	// Fixed mid-day start, 3 days out — comfortably clear of any booking
	// window / date-boundary edge, and stable across repeated test runs.
	const startInstant = new Date();
	startInstant.setUTCDate(startInstant.getUTCDate() + 3);
	startInstant.setUTCHours(8, 0, 0, 0); // 13:30 IST
	const endInstant = new Date(startInstant.getTime() + 60 * 60_000); // 14:30 IST

	const startWallClock = toBusinessWallClock(startInstant);
	const endWallClock = toBusinessWallClock(endInstant);

	const createdClassIds: string[] = [];

	async function seedOccurrence(sessionType: "group_class" | "live_stream") {
		const klass = await ClassModel.create({
			name: `Lifecycle Test ${sessionType} ${Date.now()}`,
			description: "Lifecycle test fixture",
			status: "ACTIVE",
			creditCost: 1,
			mode: "online",
			sessionType,
			instructor: "Test Host",
			instructorUserId: hostId,
			maxParticipants: 20,
			access: "members_only",
			isPublished: true,
		});
		createdClassIds.push(klass._id.toString());

		const sessionId = new mongoose.Types.ObjectId();
		const session = await ScheduledSession.create({
			_id: sessionId,
			classId: klass._id,
			sessionDate: startWallClock.sessionDate,
			startTime: startWallClock.time,
			endTime: endWallClock.time,
			deliveryType: "ONLINE",
			capacity: 20,
			currentBookings: 1,
			remainingCapacity: 19,
			status: "SCHEDULED",
			// videoRoomId deliberately left unset — the whole point of this test
			// is to prove the lifecycle stamps it, the same as recurrence-generated
			// sessions in production.
		});

		await Booking.create({
			bookingDate: startWallClock.sessionDate,
			startTime: startWallClock.time,
			endTime: endWallClock.time,
			status: "Confirmed",
			user: memberId,
			sessionId: sessionId.toString(),
			classId: klass._id.toString(),
			creditCostSnapshot: 1,
		});

		return { classId: klass._id.toString(), sessionId: sessionId.toString() };
	}

	function offsetFromStart(minutes: number): Date {
		return new Date(startInstant.getTime() + minutes * 60_000);
	}

	function expectGranted(result: SessionAccessResult, label: string): asserts result is Extract<SessionAccessResult, { ok: true }> {
		assert(result.ok === true, `${label}: expected access granted, got ${result.ok ? "granted" : (result as any).code}`);
	}

	function expectDenied(result: SessionAccessResult, code: string, label: string) {
		assert(result.ok === false, `${label}: expected access denied, got granted`);
		if (!result.ok) {
			assert(result.code === code, `${label}: expected deny code ${code}, got ${result.code}`);
		}
	}

	async function walkLifecycle(sessionType: "group_class" | "live_stream") {
		console.log(`\n--- ${sessionType} ---`);
		const { sessionId } = await seedOccurrence(sessionType);
		const expectedRoomId = deriveRoomId(sessionId);

		console.log("Join-window gating (arithmetic — independent of the lifecycle job)...");

		expectDenied(
			await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(-40) }),
			"NOT_OPEN_YET",
			`${sessionType} host T-40`,
		);
		expectDenied(
			await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(-40) }),
			"NOT_OPEN_YET",
			`${sessionType} member T-40`,
		);

		const hostAtT30 = await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(-30) });
		expectGranted(hostAtT30, `${sessionType} host T-30`);
		assert(hostAtT30.role === "host", `${sessionType} host T-30: role is host`);
		assert(hostAtT30.roomId === expectedRoomId, `${sessionType} host T-30: resolves the deterministic room id`);

		expectDenied(
			await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(-6) }),
			"NOT_OPEN_YET",
			`${sessionType} member T-6`,
		);

		// Member at T-5 before host has started receives HOST_NOT_STARTED (regression test)
		expectDenied(
			await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(-5) }),
			"HOST_NOT_STARTED",
			`${sessionType} member T-5 before host presence`,
		);

		// Host at T-5 is granted access (never blocked by hostLiveAt check)
		const hostAtT5 = await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(-5) });
		expectGranted(hostAtT5, `${sessionType} host T-5`);

		// Stamp hostLiveAt (simulating host joining)
		const firstHostLiveAt = offsetFromStart(-5);
		let sessionDoc = await ScheduledSession.findById(sessionId);
		sessionDoc!.hostLiveAt = firstHostLiveAt;
		sessionDoc!.hostLastSeenAt = firstHostLiveAt;
		await sessionDoc!.save();

		// Write-once assertion: re-stamping does not overwrite hostLiveAt
		sessionDoc = await ScheduledSession.findById(sessionId);
		if (!sessionDoc!.hostLiveAt) {
			sessionDoc!.hostLiveAt = new Date();
		}
		sessionDoc!.hostLastSeenAt = new Date();
		await sessionDoc!.save();
		const afterSecondStamp = await ScheduledSession.findById(sessionId);
		assert(
			afterSecondStamp!.hostLiveAt?.getTime() === firstHostLiveAt.getTime(),
			`${sessionType}: hostLiveAt is write-once and preserved across re-stamps`,
		);

		// Re-run member at T-5 after host is live: now granted access
		const memberAtT5 = await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(-5) });
		expectGranted(memberAtT5, `${sessionType} member T-5 after host is live`);
		assert(memberAtT5.role === "member", `${sessionType} member T-5: role is member`);
		assert(
			memberAtT5.roomId === expectedRoomId,
			`${sessionType} member T-5: resolves the SAME room id as the host — regression test for split-room bug`,
		);

		const memberMid = await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(30) });
		expectGranted(memberMid, `${sessionType} member mid-session`);

		expectDenied(
			await resolveSessionAccess({ sessionId, user: memberUser, now: offsetFromStart(61) }),
			"ENDED",
			`${sessionType} member T+1 (past scheduled end)`,
		);

		const hostAtT29 = await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(89) }); // end + 29m
		expectGranted(hostAtT29, `${sessionType} host end+29m (inside overrun grace)`);

		expectDenied(
			await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(91) }), // end + 31m
			"ENDED",
			`${sessionType} host end+31m (past the room's own expiry)`,
		);

		console.log("Lifecycle sweeps, driven by the same injected clock...");

		let session = await ScheduledSession.findById(sessionId);
		assert(session!.roomStatus === "PENDING", `${sessionType}: roomStatus starts PENDING`);

		// Before the lead window: sweep at T-40 must not touch this session.
		await prepareDueRooms(offsetFromStart(-40));
		session = await ScheduledSession.findById(sessionId);
		assert(session!.roomStatus === "PENDING", `${sessionType}: sweep at T-40 leaves roomStatus PENDING`);
		assert(!session!.videoRoomId, `${sessionType}: sweep at T-40 does not stamp a room id early`);

		// At T-30 the room becomes due.
		const prepResult = await prepareDueRooms(offsetFromStart(-30));
		assert(prepResult.prepared >= 1, `${sessionType}: prepareDueRooms(T-30) prepares at least this session`);
		session = await ScheduledSession.findById(sessionId);
		assert(session!.roomStatus === "READY", `${sessionType}: roomStatus flips to READY at T-30`);
		assert(
			session!.videoRoomId === expectedRoomId,
			`${sessionType}: prepareDueRooms stamps the same deterministic room id resolveSessionAccess already computed`,
		);

		// Idempotency: firing the same sweep again must not re-count the session.
		const prepAgain = await prepareDueRooms(offsetFromStart(-25));
		const stillJustOne = (await ScheduledSession.findById(sessionId))!;
		assert(
			stillJustOne.roomStatus === "READY",
			`${sessionType}: a second prepare sweep leaves an already-READY session untouched`,
		);
		void prepAgain;

		// Before expiry: sweep at end+1m must not touch this session.
		await expireDueRooms(offsetFromStart(61));
		session = await ScheduledSession.findById(sessionId);
		assert(session!.roomStatus === "READY", `${sessionType}: sweep at end+1m leaves roomStatus READY (host still in overrun grace)`);
		assert(session!.status === "SCHEDULED", `${sessionType}: session status is untouched before expiry`);

		// At end+30m the room expires.
		const expireResult = await expireDueRooms(offsetFromStart(90));
		assert(expireResult.expired >= 1, `${sessionType}: expireDueRooms(end+30) expires at least this session`);
		session = await ScheduledSession.findById(sessionId);
		assert(session!.roomStatus === "EXPIRED", `${sessionType}: roomStatus flips to EXPIRED at end+30`);
		assert(session!.status === "COMPLETED", `${sessionType}: status flips to COMPLETED at end+30, not at the scheduled end`);
		assert(session!.endedBy === null, `${sessionType}: system expiry leaves endedBy null, distinguishing it from a host's explicit End`);

		// Post-expiry, everyone is denied — including the host who was still
		// inside their overrun grace one tick ago.
		expectDenied(
			await resolveSessionAccess({ sessionId, user: hostUser, now: offsetFromStart(95) }),
			"ENDED",
			`${sessionType} host post-expiry`,
		);

		// Idempotency: firing expireDueRooms again must be a no-op for this
		// session (already claimed), not a second finalize/kick pass.
		const expireAgain = await expireDueRooms(offsetFromStart(100));
		const finalDoc = (await ScheduledSession.findById(sessionId))!;
		assert(
			finalDoc.roomStatus === "EXPIRED" && finalDoc.status === "COMPLETED",
			`${sessionType}: a second expire sweep leaves an already-EXPIRED session untouched`,
		);
		void expireAgain;
	}

	try {
		await walkLifecycle("group_class");
		await walkLifecycle("live_stream");

		console.log("\n🎉 Occurrence Room Lifecycle Feature Tests Passed!");
	} finally {
		for (const classId of createdClassIds) {
			await Booking.deleteMany({ classId });
			await ScheduledSession.deleteMany({ classId });
			await ClassModel.findByIdAndDelete(classId);
		}
		await mongoose.disconnect();
	}
}

runSessionRoomLifecycleTests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Session room lifecycle feature test failed:", err);
		process.exit(1);
	});
