import mongoose from "mongoose";
import Booking from "../models/Bookings";
import ClassModel from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { normalizeRole } from "../middleware/rbac.middleware";
import type { AuthenticatedUser } from "../types/auth";
import {
	buildJoinWindow,
	combineSessionDateTime,
	nonCancelledBookingStatusFilter,
	sanitizeRoomId,
	type SessionRole,
} from "../utils/zego-room";

const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 7200;

export type DenyCode =
	| "NO_SCHEDULE"
	| "NO_BOOKING"
	| "CANCELLED"
	| "ENDED"
	| "NOT_OPEN_YET"
	| "NO_ROOM";

const DENY_STATUS: Record<DenyCode, number> = {
	NO_SCHEDULE: 409,
	NO_BOOKING: 403,
	CANCELLED: 409,
	ENDED: 409,
	NOT_OPEN_YET: 403,
	NO_ROOM: 409,
};

const DENY_MESSAGE: Record<DenyCode, string> = {
	NO_SCHEDULE: "This session has no valid schedule.",
	NO_BOOKING: "No active booking found for this session.",
	CANCELLED: "This session has been cancelled.",
	ENDED: "This class has ended.",
	NOT_OPEN_YET: "The join window for this class has not opened yet.",
	NO_ROOM: "No video room is available for this session.",
};

export type SessionAccessDenied = {
	ok: false;
	status: number;
	code: DenyCode;
	message: string;
};

export type SessionAccessGranted = {
	ok: true;
	role: SessionRole;
	roomId: string;
	ttlSeconds: number;
	startsAt: Date;
	endsAt: Date;
	windowOpensAt: Date;
	windowClosesAt: Date;
	booking: InstanceType<typeof Booking> | null;
	session: InstanceType<typeof ScheduledSession> | null;
	klass: { _id: unknown; instructorUserId?: unknown; sessionType?: string; name?: string; streamRoomId?: string } | null;
};

export type SessionAccessResult = SessionAccessGranted | SessionAccessDenied;

const deny = (code: DenyCode): SessionAccessDenied => ({
	ok: false,
	status: DENY_STATUS[code],
	code,
	message: DENY_MESSAGE[code],
});

/**
 * The single entry point for "can this user touch this session's Zego room
 * right now, and as what role" — used by token issuance, end-class, and
 * attendance. Every join-window / role / lifecycle rule lives here exactly
 * once, so the token endpoint and the end endpoint can never disagree about
 * who's allowed in.
 */
export const resolveSessionAccess = async ({
	sessionId,
	user,
	now = new Date(),
}: {
	sessionId: string;
	user: AuthenticatedUser;
	now?: Date;
}): Promise<SessionAccessResult> => {
	const rawUserId = user.id;
	const userObjId = mongoose.Types.ObjectId.isValid(String(rawUserId))
		? new mongoose.Types.ObjectId(String(rawUserId))
		: null;
	const sessionObjId = mongoose.Types.ObjectId.isValid(sessionId)
		? new mongoose.Types.ObjectId(sessionId)
		: null;

	// 1. Load the ScheduledSession. A bare Class (no scheduled instance) is kept
	// only to resolve the instructor for host detection — it has no wall-clock
	// time, so it can never satisfy a join window and falls through to
	// NO_SCHEDULE below rather than being treated as always-open.
	const session = sessionObjId
		? await ScheduledSession.findById(sessionObjId)
		: null;

	const klass = session
		? await ClassModel.findById(session.classId)
				.select("instructorUserId sessionType name streamRoomId")
				.lean()
		: await ClassModel.findById(sessionId)
				.select("instructorUserId sessionType name streamRoomId")
				.lean();

	if (!session && !klass) {
		return deny("NO_SCHEDULE");
	}

	// 2. Host identity: the class's designated host, or an admin operator.
	const isInstructor =
		!!klass?.instructorUserId &&
		String(klass.instructorUserId) === String(rawUserId);
	const isAdmin = normalizeRole(user.role) === "admin";
	const role: SessionRole = isInstructor || isAdmin ? "host" : "member";

	// 3. Session-level lifecycle. Once COMPLETED, it stays over for everyone —
	// re-opening a finished class is a new session, not a re-join.
	if (session?.status === "CANCELLED") {
		return deny("CANCELLED");
	}
	if (session?.status === "COMPLETED") {
		return deny("ENDED");
	}

	// 4. Absolute start/end, fail closed on anything unparseable.
	const startsAt = session
		? combineSessionDateTime(session.sessionDate, session.startTime)
		: null;
	const endsAtRaw = session
		? combineSessionDateTime(session.sessionDate, session.endTime)
		: null;

	if (!startsAt) {
		return deny("NO_SCHEDULE");
	}
	const endsAt = endsAtRaw ?? new Date(startsAt.getTime() + 60 * 60_000);

	// 5. Members must hold a live booking for this session.
	let booking: InstanceType<typeof Booking> | null = null;
	if (role === "member") {
		booking = await Booking.findOne({
			$and: [
				{
					$or: [
						{ user: rawUserId },
						...(userObjId ? [{ user: userObjId }] : []),
					],
				},
				{
					$or: [
						{ sessionId },
						{ classId: sessionId },
						...(sessionObjId ? [{ _id: sessionObjId }] : []),
					],
				},
			],
			status: nonCancelledBookingStatusFilter,
		})
			.populate("sessionId", "sessionDate startTime endTime status videoRoomId")
			.populate("classId", "zegoRoomId");

		if (!booking) {
			return deny("NO_BOOKING");
		}

		const bookingSessionObj =
			typeof booking.sessionId === "object" && booking.sessionId
				? (booking.sessionId as unknown as { status?: string })
				: null;
		if (bookingSessionObj?.status === "CANCELLED") {
			return deny("CANCELLED");
		}
	}

	// 6. Role-scoped join window — the only place lead/grace times are read.
	const window = buildJoinWindow(startsAt, endsAt, role);
	if (now.getTime() < window.opensAt.getTime()) {
		return deny("NOT_OPEN_YET");
	}
	if (now.getTime() >= window.closesAt.getTime()) {
		return deny("ENDED");
	}

	// 7. Room id — deterministic per session, same for every participant.
	//
	// This MUST NOT be derived from the caller's booking. Doing so gave the
	// host (no booking) and the member (booking) two different resolution
	// orders: the booking path never considered streamRoomId and could fall
	// all the way through to booking._id — a room unique to that one member.
	// For a live_stream the host landed on session.streamRoomId while the
	// member landed on session._id, so each sat alone in their own room and
	// the audience saw a black screen. Both roles now resolve identically,
	// off the session/class only.
	const rawRoomId =
		session?.videoRoomId ||
		session?.streamRoomId ||
		session?._id?.toString() ||
		klass?.streamRoomId ||
		sessionId;

	if (!rawRoomId) {
		return deny("NO_ROOM");
	}
	const roomId = sanitizeRoomId(String(rawRoomId));

	// 8. TTL = time left in the window, clamped. Below the floor is functionally
	// over — deny rather than hand out a token that outlives the window.
	const remainingSeconds = Math.floor(
		(window.closesAt.getTime() - now.getTime()) / 1000,
	);
	if (remainingSeconds < MIN_TTL_SECONDS) {
		return deny("ENDED");
	}
	const ttlSeconds = Math.min(remainingSeconds, MAX_TTL_SECONDS);

	return {
		ok: true,
		role,
		roomId,
		ttlSeconds,
		startsAt,
		endsAt,
		windowOpensAt: window.opensAt,
		windowClosesAt: window.closesAt,
		booking,
		session,
		klass,
	};
};
