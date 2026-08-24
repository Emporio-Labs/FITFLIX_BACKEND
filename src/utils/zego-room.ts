import { BookingStatus } from "../models/Enums";
import {
	IST_TIMEZONE,
	normalizeTimeZone,
	zonedDateTimeToInstant,
} from "./timezone.util";

/// Bookings store status inconsistently across older and newer writes (numeric
/// enum, its stringified form, and the literal "Cancelled"), so every read that
/// filters cancellations has to cover all three.
export const nonCancelledBookingStatusFilter = {
	$nin: [
		BookingStatus.Cancelled,
		String(BookingStatus.Cancelled),
		"Cancelled",
	],
};

/**
 * Zego room IDs must match the sanitisation the clients apply, otherwise the
 * signed room_id and the room actually joined diverge and the token is rejected.
 */
export const sanitizeRoomId = (roomId: string): string =>
	roomId.replace(/[^a-zA-Z0-9_-]/g, "_");

/**
 * The room ID for a scheduled session, derived from its own `_id`.
 *
 * Deterministic and prefixed so it survives `sanitizeRoomId` unchanged and can
 * be computed without a database write — which is what lets the lifecycle job,
 * the token endpoint, and every read API agree on a room without coordinating.
 */
export const deriveRoomId = (sessionId: unknown): string =>
	sanitizeRoomId(`gc_${String(sessionId)}`);

/**
 * THE room resolver. Every consumer — token issuance, booking reads, admin
 * schedule listings — must call this and nothing else.
 *
 * It deliberately considers only the session's own identity. Earlier code
 * resolved rooms from `streamRoomId`, from the parent `Class`, or from the
 * caller's `Booking`, which meant the host and the member could compute
 * different rooms and sit alone in them. Worse, `streamRoomId` holds a Zego
 * *layout template* (`interactive_class`, `large_event`, `standard_meeting`),
 * not a room ID, so every online class on the platform collapsed into one
 * shared room. Neither field belongs anywhere near room identity.
 */
export const resolveSessionRoomId = (
	session:
		| { videoRoomId?: string | null; _id?: unknown }
		| string
		| null
		| undefined,
): string | null => {
	// An un-populated ref is still an unambiguous session identity, and
	// deriveRoomId agrees with what the token endpoint computes for that same
	// session — provided legacy `videoRoomId` values have been normalised by
	// scripts/backfill-session-room-ids.ts. Run that before deploying this.
	if (typeof session === "string") {
		return session.trim() ? deriveRoomId(session.trim()) : null;
	}
	if (!session?._id) return null;
	const stored = session.videoRoomId?.trim();
	return stored ? sanitizeRoomId(stored) : deriveRoomId(session._id);
};

/// A host needs setup time; a member should not be milling about in the room
/// long before the class.
///
/// The host lead doubles as the provisioning trigger: the lifecycle job stamps
/// a session's room ID at exactly the moment the host becomes able to join it.
export const ROOM_LEAD_MINUTES = Number(
	process.env.SESSION_ROOM_LEAD_MINUTES ?? 30,
);
export const MEMBER_JOIN_LEAD_MINUTES = Number(
	process.env.SESSION_MEMBER_LEAD_MINUTES ?? 5,
);

/// A class routinely runs a little over, so the host's window stays open past
/// the scheduled end — but only until the room expires and is torn down. This
/// is the same number the lifecycle job uses to schedule that teardown, so the
/// host's token can never outlive the room it was minted for.
export const ROOM_EXPIRY_GRACE_MINUTES = Number(
	process.env.SESSION_ROOM_EXPIRY_MINUTES ?? 30,
);

/// The room persists past the scheduled end for *everyone*, not just the host:
/// a member whose connection drops in the last minute, or who is still in a
/// class that ran over, can rejoin for as long as the room is actually alive.
///
/// Deliberately the same number as the expiry grace rather than an independent
/// constant — a member window that outlived the room would hand out tokens for
/// a room the lifecycle job had already torn down, which surfaces to the member
/// as a join that succeeds and then immediately fails.
export const MEMBER_JOIN_GRACE_AFTER_MINUTES = ROOM_EXPIRY_GRACE_MINUTES;

/// How long after a nutritionist appointment's scheduled end an ACCEPTED
/// booking is still allowed to be honoured before the expiry sweep marks it
/// EXPIRED. Covers the case where the appointment was confirmed but the
/// nutritionist never hosted it — see expireStaleNutritionistBookings.
export const NUTRI_EXPIRY_GRACE_MINUTES = Number(
	process.env.NUTRITIONIST_EXPIRY_GRACE_MINUTES ?? 5,
);

/// Sessions are stored as a UTC-midnight `sessionDate` plus an "HH:mm" string,
/// and that string is gym wall-clock time, not UTC. Reading it as UTC shifts
/// every class by the zone offset — 5h30m for IST, which is long enough to
/// close the join window before the class has even started.
///
/// Normalised on the way in: a value this runtime cannot resolve (a quoted
/// `.env` line, a typo, "IST") falls back to Asia/Kolkata with a warning rather
/// than reaching `Intl` and throwing mid-request. A *valid* but wrong zone —
/// `BUSINESS_TIMEZONE=UTC` — is not something normalisation can detect; the
/// startup check in index.ts exists for that case.
///
/// This is the platform-wide default only. A class at a branch in another zone
/// resolves through Location.timezone — see utils/location.resolver.ts.
export const BUSINESS_TIMEZONE = normalizeTimeZone(
	process.env.BUSINESS_TIMEZONE ?? IST_TIMEZONE,
);

/**
 * Combines a session's date with its "HH:mm" wall-clock time, interpreting that
 * time in [BUSINESS_TIMEZONE].
 *
 * Returns null when either part is missing or unparseable, so callers can fail
 * closed rather than admitting everyone to a session with a malformed schedule.
 */
export const combineSessionDateTime = (
	sessionDate: Date | string | null | undefined,
	time: string | null | undefined,
	timeZone: string = BUSINESS_TIMEZONE,
): Date | null => {
	if (!sessionDate || !time) return null;

	const base = new Date(sessionDate);
	if (Number.isNaN(base.getTime())) return null;

	const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!match) return null;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;

	// The zone arithmetic itself lives in exactly one place — timezone.util.ts
	// resolves the offset twice so a DST boundary between the first guess and
	// the true instant lands on the right side. This function keeps only the
	// parsing and the fail-closed nulls, which are what its callers depend on.
	//
	// `sessionDate` is written at UTC midnight, so its UTC calendar date is the
	// intended day; zonedDateTimeToInstant reads exactly that.
	return zonedDateTimeToInstant(base, `${hours}:${minutes}`, timeZone);
};

/**
 * A session's start and end as absolute instants.
 *
 * Use this rather than calling [combineSessionDateTime] twice. A session is
 * stored as one date plus two "HH:mm" strings, so a 23:30–00:30 booking
 * resolves its end to 23 hours *before* its own start when both are composed
 * against the same day. Every consequence of that is silent and wrong: the
 * join window closes before it opens, so a member is refused the room their
 * session is about to start in.
 *
 * An end at or before the start belongs to the next day. The wrap re-enters
 * [combineSessionDateTime] with the following calendar date rather than adding
 * 24 hours to the result, so the timezone offset is resolved for the day the
 * session actually ends — adding a fixed day would be wrong across a DST
 * boundary even though [BUSINESS_TIMEZONE] does not currently observe one.
 */
export const combineSessionWindow = (
	sessionDate: Date | string | null | undefined,
	startTime: string | null | undefined,
	endTime: string | null | undefined,
	timeZone: string = BUSINESS_TIMEZONE,
): { startsAt: Date | null; endsAt: Date | null } => {
	const startsAt = combineSessionDateTime(sessionDate, startTime, timeZone);
	let endsAt = combineSessionDateTime(sessionDate, endTime, timeZone);

	if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
		const base = new Date(sessionDate as Date | string);
		const nextDay = new Date(
			Date.UTC(
				base.getUTCFullYear(),
				base.getUTCMonth(),
				base.getUTCDate() + 1,
			),
		);
		endsAt = combineSessionDateTime(nextDay, endTime, timeZone);
	}

	return { startsAt, endsAt };
};

export type SessionRole = "host" | "member";

export type JoinWindow = {
	opensAt: Date;
	closesAt: Date;
};

export type RoomTimeline = {
	/// Room ID is assigned and the host may join.
	roomReadyAt: Date;
	/// Booked members may join.
	memberOpensAt: Date;
	/// Member access closes — the scheduled end plus the grace, which tracks
	/// the room's own expiry, so it coincides with `roomExpiresAt`.
	memberClosesAt: Date;
	/// Room is torn down and the session is durably over.
	roomExpiresAt: Date;
};

/**
 * The whole lifecycle of one session's room, as absolute instants.
 *
 * Identical for `group_class` and `live_stream` — the only thing that differs
 * between the two is the Zego publish privilege, which is decided at token
 * minting, not here.
 *
 * Both the join gate and the lifecycle job read this one function, so the job
 * can never tear down a room the gate still considers open (or vice versa).
 */
export const buildRoomTimeline = (
	start: Date,
	end: Date | null,
	leadMinutes: number = ROOM_LEAD_MINUTES,
): RoomTimeline => {
	// A session with no parseable end time still gets a bounded lifecycle
	// rather than an open-ended one.
	const effectiveEnd = end ?? new Date(start.getTime() + 60 * 60_000);

	return {
		roomReadyAt: new Date(start.getTime() - leadMinutes * 60_000),
		memberOpensAt: new Date(start.getTime() - MEMBER_JOIN_LEAD_MINUTES * 60_000),
		memberClosesAt: new Date(
			effectiveEnd.getTime() + MEMBER_JOIN_GRACE_AFTER_MINUTES * 60_000,
		),
		roomExpiresAt: new Date(
			effectiveEnd.getTime() + ROOM_EXPIRY_GRACE_MINUTES * 60_000,
		),
	};
};

export const buildJoinWindow = (
	start: Date,
	end: Date | null,
	role: SessionRole,
	leadMinutes?: number,
): JoinWindow => {
	const timeline = buildRoomTimeline(start, end, leadMinutes);

	return role === "host"
		? { opensAt: timeline.roomReadyAt, closesAt: timeline.roomExpiresAt }
		: { opensAt: timeline.memberOpensAt, closesAt: timeline.memberClosesAt };
};
