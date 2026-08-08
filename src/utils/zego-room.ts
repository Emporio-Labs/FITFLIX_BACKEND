import { BookingStatus } from "../models/Enums";

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
 * The single source of truth for "which Zego room does this booking map to".
 *
 * The precedence below is the one already used when serving bookings to admin
 * and user clients — if the token endpoint derived a room ID any other way, a
 * member and their trainer would be issued tokens for two different rooms and
 * neither would see the other. Keep this function as the only implementation.
 */
export const resolveRoomIdFromBooking = (booking: {
	sessionId?: unknown;
	classId?: unknown;
	_id?: unknown;
}): string | null => {
	const session = booking.sessionId as
		| { videoRoomId?: string | null; _id?: unknown }
		| string
		| null
		| undefined;
	const klass = booking.classId as
		| { zegoRoomId?: string | null; _id?: unknown }
		| string
		| null
		| undefined;

	const candidates: Array<unknown> = [
		typeof session === "object" && session ? session.videoRoomId : null,
		typeof session === "object" && session ? session._id : null,
		typeof session === "string" ? session : null,
		typeof klass === "object" && klass ? klass.zegoRoomId : null,
		typeof klass === "object" && klass ? klass._id : null,
		typeof klass === "string" ? klass : null,
		booking._id,
	];

	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim() !== "") {
			return candidate;
		}
		if (candidate && typeof candidate === "object") {
			const asString = String(candidate);
			if (asString && asString !== "[object Object]") {
				return asString;
			}
		}
	}

	return null;
};

/**
 * Zego room IDs must match the sanitisation the clients apply, otherwise the
 * signed room_id and the room actually joined diverge and the token is rejected.
 */
export const sanitizeRoomId = (roomId: string): string =>
	roomId.replace(/[^a-zA-Z0-9_-]/g, "_");

/// A host needs setup time; a member should not be milling about in the room
/// long before the class. The member grace is deliberately zero — once the
/// class is over, the room is closed to members (there is no "just this once".)
export const HOST_JOIN_LEAD_MINUTES = 30;
export const MEMBER_JOIN_LEAD_MINUTES = 5;
export const MEMBER_JOIN_GRACE_AFTER_MINUTES = 0;

/// A class routinely runs over. The host's window stays open past the scheduled
/// end so the session isn't cut off mid-sentence; it closes for real when the
/// host ends the class, which is an explicit action.
export const HOST_OVERRUN_GRACE_MINUTES = Number(
	process.env.SESSION_HOST_OVERRUN_MINUTES ?? 120,
);

/// Sessions are stored as a UTC-midnight `sessionDate` plus an "HH:mm" string,
/// and that string is gym wall-clock time, not UTC. Reading it as UTC shifts
/// every class by the zone offset — 5h30m for IST, which is long enough to
/// close the join window before the class has even started.
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";

/**
 * Offset of [timeZone] from UTC at a given instant, in milliseconds.
 *
 * Derived via `Intl` rather than hardcoded to +05:30 so the value stays correct
 * if the business timezone is ever repointed somewhere that observes DST.
 */
const zoneOffsetMs = (instant: Date, timeZone: string): number => {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			hour12: false,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		})
			.formatToParts(instant)
			.map((part) => [part.type, part.value]),
	);

	return (
		Date.UTC(
			Number(parts.year),
			Number(parts.month) - 1,
			Number(parts.day),
			Number(parts.hour) % 24,
			Number(parts.minute),
			Number(parts.second),
		) - instant.getTime()
	);
};

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
): Date | null => {
	if (!sessionDate || !time) return null;

	const base = new Date(sessionDate);
	if (Number.isNaN(base.getTime())) return null;

	const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!match) return null;

	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) return null;

	// `sessionDate` is written at UTC midnight, so its UTC calendar date is the
	// intended day. Resolve twice: the first pass picks the offset from a rough
	// instant, the second re-reads it at the corrected one, which is what makes
	// this right across a DST boundary.
	const naive = Date.UTC(
		base.getUTCFullYear(),
		base.getUTCMonth(),
		base.getUTCDate(),
		hours,
		minutes,
	);
	const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), BUSINESS_TIMEZONE));
	return new Date(naive - zoneOffsetMs(firstPass, BUSINESS_TIMEZONE));
};

export type SessionRole = "host" | "member";

export type JoinWindow = {
	opensAt: Date;
	closesAt: Date;
};

export const buildJoinWindow = (
	start: Date,
	end: Date | null,
	role: SessionRole,
): JoinWindow => {
	const leadMinutes =
		role === "host" ? HOST_JOIN_LEAD_MINUTES : MEMBER_JOIN_LEAD_MINUTES;
	const graceMinutes =
		role === "host" ? HOST_OVERRUN_GRACE_MINUTES : MEMBER_JOIN_GRACE_AFTER_MINUTES;

	const opensAt = new Date(start.getTime() - leadMinutes * 60_000);
	// A session with no parseable end time still gets a bounded window rather
	// than an open-ended one.
	const effectiveEnd = end ?? new Date(start.getTime() + 60 * 60_000);
	const closesAt = new Date(effectiveEnd.getTime() + graceMinutes * 60_000);

	return { opensAt, closesAt };
};
