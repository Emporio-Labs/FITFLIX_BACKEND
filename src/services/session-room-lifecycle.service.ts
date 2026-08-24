import ClassModel from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { resolveTimeZone } from "../utils/location.resolver";
import {
	buildRoomTimeline,
	combineSessionDateTime,
	deriveRoomId,
	resolveSessionRoomId,
	ROOM_LEAD_MINUTES,
} from "../utils/zego-room";
import { finalizeSession } from "./session-finalize.service";
import { listRoomUsers, readZegoServerConfig } from "./zego-server-api.service";

const BATCH_LIMIT = 200;

// Small and sequential on purpose: Zego rate-limits DescribeUserList to
// 1 req/sec per room, and this issues one call per candidate room per tick.
const HOST_VERIFY_BATCH_LIMIT = 25;

// Only occurrences within a day of "now" are worth loading per tick — this
// keeps the scan index-friendly (see the roomStatus+sessionDate index on
// ScheduledSession) rather than a full-collection scan as history grows.
const CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Stamps a room ID and flips `roomStatus` to READY for every occurrence whose
 * lead time has arrived — the T-minus-lead "room creation" the product spec
 * asks for. There is no Zego API call here: a Zego room is implicit on first
 * join, so "creating" it is committing the ID every participant will resolve
 * to, deterministically, ahead of anyone actually joining.
 *
 * Runs identically for `group_class` and `live_stream` — nothing here branches
 * on `sessionType`; the only session-type-specific behavior in the whole
 * lifecycle is the Zego publish privilege decided at token-mint time.
 */
export async function prepareDueRooms(
	now: Date = new Date(),
): Promise<{ prepared: number; skipped: number }> {
	let prepared = 0;
	let skipped = 0;

	const candidates = await ScheduledSession.find({
		roomStatus: "PENDING",
		deliveryType: { $in: ["ONLINE", "HYBRID"] },
		status: { $in: ["SCHEDULED", "FULL"] },
		sessionDate: {
			$gte: new Date(now.getTime() - CANDIDATE_WINDOW_MS),
			$lte: new Date(now.getTime() + CANDIDATE_WINDOW_MS),
		},
	})
		.limit(BATCH_LIMIT)
		.lean();

	if (candidates.length === 0) return { prepared, skipped };

	// Batch the per-class lead override lookup rather than one query per
	// session — most of a tick's candidates share a handful of classes.
	const classIds = [...new Set(candidates.map((c) => String(c.classId)))];
	const classes = await ClassModel.find({ _id: { $in: classIds } })
		.select("occurrenceLeadMinutes locationId")
		.lean();
	const leadByClassId = new Map(
		classes.map((c) => [String(c._id), c.occurrenceLeadMinutes]),
	);

	// The join gate resolves the branch zone the same way. If this job used a
	// different one it would stamp a room ready at a different moment than the
	// host is allowed through — the two must read the same clock.
	const zoneByClassId = new Map<string, string>();
	for (const c of classes) {
		zoneByClassId.set(
			String(c._id),
			await resolveTimeZone({ locationId: c.locationId }),
		);
	}

	for (const session of candidates) {
		try {
			const timeZone = zoneByClassId.get(String(session.classId));
			const start = combineSessionDateTime(
				session.sessionDate,
				session.startTime,
				timeZone,
			);
			if (!start) {
				skipped++;
				continue;
			}
			const end = combineSessionDateTime(
				session.sessionDate,
				session.endTime,
				timeZone,
			);

			const leadOverride = leadByClassId.get(String(session.classId));
			const leadMinutes = Number.isFinite(Number(leadOverride))
				? Number(leadOverride)
				: ROOM_LEAD_MINUTES;
			const timeline = buildRoomTimeline(start, end, leadMinutes);

			if (now.getTime() < timeline.roomReadyAt.getTime()) {
				continue; // not due yet — leave PENDING for a later tick
			}

			// Atomic claim: two overlapping ticks (e.g. the external caller and
			// the in-process poller) must not both "prepare" the same session.
			const claimed = await ScheduledSession.findOneAndUpdate(
				{ _id: session._id, roomStatus: "PENDING" },
				{
					$set: {
						roomStatus: "READY",
						// Never overwrite a room id the manual admin flow already set.
						videoRoomId:
							(session as any).videoRoomId?.trim?.() ||
							deriveRoomId(session._id),
						roomReadyAt: now,
						roomExpiresAt: timeline.roomExpiresAt,
					},
				},
			);
			if (!claimed) {
				skipped++; // already claimed by a concurrent tick
				continue;
			}
			prepared++;
		} catch (err) {
			console.error(
				`[session-room-lifecycle] prepare failed for ${String(session._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { prepared, skipped };
}

/**
 * Tears down every room whose expiry has passed — the T+30 "room expires"
 * half of the spec. Reuses `finalizeSession`, the exact same teardown the
 * host's manual "End" button runs, so a session ended by a stalled host and
 * one ended by this sweep are indistinguishable except for `endedBy: null`.
 */
export async function expireDueRooms(
	now: Date = new Date(),
): Promise<{
	expired: number;
	skipped: number;
	kickErrors: Array<{ sessionId: string; message: string }>;
}> {
	let expired = 0;
	let skipped = 0;
	const kickErrors: Array<{ sessionId: string; message: string }> = [];
	const zegoConfig = readZegoServerConfig();

	const due = await ScheduledSession.find({
		roomStatus: "READY",
		roomExpiresAt: { $lte: now },
	}).limit(BATCH_LIMIT);

	for (const session of due) {
		try {
			// Atomic claim on the room, mirroring the PENDING->READY claim above —
			// this is what makes a double-fired tick safe to run concurrently.
			const claimed = await ScheduledSession.findOneAndUpdate(
				{ _id: session._id, roomStatus: "READY" },
				{ $set: { roomStatus: "EXPIRED" } },
				{ returnDocument: "after" },
			);
			if (!claimed) {
				skipped++;
				continue;
			}

			const result = await finalizeSession(claimed, {
				endedBy: null, // system-ended, distinguishable from a host's explicit end
				endedAt: session.roomExpiresAt ?? now,
				reason: "Room expired",
				zegoConfig,
			});

			if (result.kickErrors.length > 0) {
				for (const e of result.kickErrors) {
					kickErrors.push({ sessionId: String(session._id), message: e.message });
				}
			}
			expired++;
		} catch (err) {
			console.error(
				`[session-room-lifecycle] expire failed for ${String(session._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { expired, skipped, kickErrors };
}

/**
 * Self-heal for POST .../host-presence: catches a host whose client never
 * called that endpoint (crash, connectivity loss, or an older client build
 * that hasn't wired the callback). A member's join is gated on
 * `ScheduledSession.hostLiveAt` being set — see session-access.service.ts's
 * HOST_NOT_STARTED check — so without this sweep, a host who reported
 * nothing would leave every member stuck waiting even though the host is
 * genuinely in the room.
 *
 * Restricted to `roomStatus: "READY", hostLiveAt: null` (see the
 * roomStatus+hostLiveAt index on ScheduledSession) so a class that's already
 * live, or hasn't reached its room-ready lead time yet, costs nothing here.
 */
export async function verifyHostPresence(
	now: Date = new Date(),
): Promise<{ verified: number; skipped: number }> {
	let verified = 0;
	let skipped = 0;

	const zegoConfig = readZegoServerConfig();
	if (!zegoConfig) return { verified, skipped };

	const candidates = await ScheduledSession.find({
		roomStatus: "READY",
		hostLiveAt: null,
	})
		.limit(HOST_VERIFY_BATCH_LIMIT)
		.lean();

	if (candidates.length === 0) return { verified, skipped };

	const classIds = [...new Set(candidates.map((c) => String(c.classId)))];
	const classes = await ClassModel.find({ _id: { $in: classIds } })
		.select("instructorUserId")
		.lean();
	const instructorByClassId = new Map(
		classes.map((c) => [
			String(c._id),
			c.instructorUserId ? String(c.instructorUserId) : null,
		]),
	);

	for (const session of candidates) {
		try {
			const instructorUserId = instructorByClassId.get(String(session.classId));
			if (!instructorUserId) {
				// No designated host on the class — an admin could still start it,
				// but admins aren't identifiable by a fixed user id the way the
				// instructor is, so there is nothing here to verify against. The
				// host's own reportHostPresence call is the only signal available.
				skipped++;
				continue;
			}

			const roomId = resolveSessionRoomId(session as any);
			if (!roomId) {
				skipped++;
				continue;
			}

			const userIds = await listRoomUsers(zegoConfig, roomId);
			if (!userIds.includes(instructorUserId)) {
				continue; // host genuinely isn't in yet — not an error, just not due
			}

			// Atomic write-once claim, mirroring reportHostPresence — whichever of
			// a concurrent client heartbeat or this sweep lands first wins, and
			// the other becomes a no-op rather than a double write.
			const claimed = await ScheduledSession.findOneAndUpdate(
				{ _id: session._id, hostLiveAt: null },
				{ $set: { hostLiveAt: now, hostLastSeenAt: now } },
			);
			if (claimed) verified++;
		} catch (err) {
			console.error(
				`[session-room-lifecycle] verifyHostPresence failed for ${String(session._id)}`,
				err,
			);
			skipped++;
		}
	}

	return { verified, skipped };
}
