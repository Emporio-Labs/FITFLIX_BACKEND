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

export const JOIN_WINDOW_BEFORE_MINUTES = 30;
export const JOIN_WINDOW_GRACE_AFTER_MINUTES = 15;

/**
 * Combines a session's date with its "HH:mm" wall-clock time.
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

	const combined = new Date(base);
	combined.setUTCHours(hours, minutes, 0, 0);
	return combined;
};

export type JoinWindow = {
	opensAt: Date;
	closesAt: Date;
};

export const buildJoinWindow = (
	start: Date,
	end: Date | null,
): JoinWindow => {
	const opensAt = new Date(
		start.getTime() - JOIN_WINDOW_BEFORE_MINUTES * 60_000,
	);
	// A session with no parseable end time still gets a bounded window rather
	// than an open-ended one.
	const effectiveEnd = end ?? new Date(start.getTime() + 60 * 60_000);
	const closesAt = new Date(
		effectiveEnd.getTime() + JOIN_WINDOW_GRACE_AFTER_MINUTES * 60_000,
	);
	return { opensAt, closesAt };
};
