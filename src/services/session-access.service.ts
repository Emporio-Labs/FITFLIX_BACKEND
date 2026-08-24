import mongoose from "mongoose";
import Booking from "../models/Bookings";
import ClassModel from "../models/Class";
import NutritionistBooking from "../models/NutritionistBooking";
import ScheduledSession from "../models/ScheduledSession";
import UnifiedBooking from "../models/UnifiedBooking";
import { normalizeRole } from "../middleware/rbac.middleware";
import type { AuthenticatedUser } from "../types/auth";
import { resolveTimeZone } from "../utils/location.resolver";
import {
	buildJoinWindow,
	combineSessionWindow,
	nonCancelledBookingStatusFilter,
	resolveSessionRoomId,
	ROOM_LEAD_MINUTES,
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
	| "HOST_NOT_STARTED"
	| "NO_ROOM";

const DENY_STATUS: Record<DenyCode, number> = {
	NO_SCHEDULE: 409,
	NO_BOOKING: 403,
	CANCELLED: 409,
	ENDED: 409,
	NOT_OPEN_YET: 403,
	HOST_NOT_STARTED: 403,
	NO_ROOM: 409,
};

const DENY_MESSAGE: Record<DenyCode, string> = {
	NO_SCHEDULE: "This session has no valid schedule.",
	NO_BOOKING: "No active booking found for this session.",
	CANCELLED: "This session has been cancelled.",
	ENDED: "This class has ended.",
	NOT_OPEN_YET: "The join window for this class has not opened yet.",
	HOST_NOT_STARTED: "The host hasn't started this class yet.",
	NO_ROOM: "No video room is available for this session.",
};

export type SessionAccessDenied = {
	ok: false;
	status: number;
	code: DenyCode;
	message: string;
	startsAt?: Date;
	endsAt?: Date;
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
	nutritionistBooking?: any;
	unifiedBooking?: any;
	hostLiveAt: Date | null;
	klass: {
		_id: unknown;
		instructorUserId?: unknown;
		sessionType?: string;
		name?: string;
		/// Zego layout template, not a room id — see ScheduledSession.streamRoomId.
		streamRoomId?: string;
		occurrenceLeadMinutes?: number;
	} | null;
};

export type SessionAccessResult = SessionAccessGranted | SessionAccessDenied;

const deny = (code: DenyCode, extra?: { startsAt?: Date; endsAt?: Date }): SessionAccessDenied => ({
	ok: false,
	status: DENY_STATUS[code],
	code,
	message: DENY_MESSAGE[code],
	...(extra || {}),
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
				.select("instructorUserId sessionType name streamRoomId access bookingRequirement creditCost occurrenceLeadMinutes locationId")
				.lean()
		: await ClassModel.findById(sessionId)
				.select("instructorUserId sessionType name streamRoomId access bookingRequirement creditCost occurrenceLeadMinutes locationId")
				.lean();

	if (!session && !klass) {
		const cleanId = sessionId.startsWith("session_")
			? sessionId.replace("session_", "")
			: sessionId.startsWith("nutri_session_")
				? sessionId.replace("nutri_session_", "")
				: sessionId;

		let unifiedBooking: any = null;
		let nutriBooking: any = null;

		if (mongoose.Types.ObjectId.isValid(cleanId)) {
			unifiedBooking = await UnifiedBooking.findById(cleanId);
			if (!unifiedBooking) {
				nutriBooking = await NutritionistBooking.findById(cleanId);
			}
		}

		if (!unifiedBooking && !nutriBooking) {
			unifiedBooking = await UnifiedBooking.findOne({ zegoRoomId: sessionId });
			if (!unifiedBooking) {
				nutriBooking = await NutritionistBooking.findOne({ zegoRoomId: sessionId });
			}
		}

		if (unifiedBooking) {
			const userRoleNorm = normalizeRole(user.role);
			const isHostRole =
				userRoleNorm === "admin" ||
				userRoleNorm === "frontdesk" ||
				userRoleNorm === "staff" ||
				(unifiedBooking.expertId &&
					String(unifiedBooking.expertId) === String(rawUserId));
			const isMember = String(unifiedBooking.userId) === String(rawUserId);

			if (!isHostRole && !isMember) {
				return deny("NO_BOOKING");
			}

			const role: SessionRole = isHostRole ? "host" : "member";

			if (
				unifiedBooking.status === "CANCELLED" ||
				unifiedBooking.status === "REJECTED" ||
				unifiedBooking.status === "HOST_NO_SHOW"
			) {
				return deny("CANCELLED");
			}
			if (unifiedBooking.status === "COMPLETED") {
				return deny("ENDED");
			}

			// Paired, so a session running past midnight ends on the next day
			// rather than 23 hours before it started — which closed this
			// window before it opened and refused the member their own room.
			//
			// Read in the booking's own branch zone: "09:00" at a branch means
			// 09:00 there, and resolving it against a global default would put
			// the session hours from where both parties expect it.
			const window = combineSessionWindow(
				unifiedBooking.bookingDate,
				unifiedBooking.startTime,
				unifiedBooking.endTime,
				await resolveTimeZone({
					locationId: unifiedBooking.locationId,
					userId: unifiedBooking.userId,
				}),
			);
			const startsAt = window.startsAt;
			const endsAt =
				window.endsAt ||
				new Date((startsAt?.getTime() ?? Date.now()) + 45 * 60_000);

			if (!startsAt) {
				return deny("NO_SCHEDULE");
			}

			// Group Classes & 1:1 PT Session Rule Parity:
			// Host enters up to 30 mins prior; Member enters 5 mins prior
			const hostLeadMs = 30 * 60_000;
			const memberLeadMs = 5 * 60_000;
			const windowOpensAt = new Date(
				startsAt.getTime() - (role === "host" ? hostLeadMs : memberLeadMs),
			);
			// 30-minute overrun buffer after scheduled end
			const windowClosesAt = new Date(endsAt.getTime() + 30 * 60_000);

			if (now.getTime() < windowOpensAt.getTime()) {
				return deny("NOT_OPEN_YET", { startsAt, endsAt });
			}
			if (now.getTime() >= windowClosesAt.getTime()) {
				return deny("ENDED", { startsAt, endsAt });
			}

			// When Host enters, record hostLiveAt timestamp to unlock the lobby for members
			if (role === "host" && !unifiedBooking.hostLiveAt) {
				unifiedBooking.hostLiveAt = new Date();
				await unifiedBooking.save();
			}

			// Host Presence Gate: Member waits in lobby until Host has launched the call
			if (role === "member" && !unifiedBooking.hostLiveAt) {
				return deny("HOST_NOT_STARTED", { startsAt, endsAt });
			}

			if (role === "member" && !unifiedBooking.userJoinedAt) {
				unifiedBooking.userJoinedAt = new Date();
				await unifiedBooking.save();
			}

			const roomId =
				unifiedBooking.zegoRoomId || `session_${unifiedBooking._id.toString()}`;
			const remainingSeconds = Math.floor(
				(windowClosesAt.getTime() - now.getTime()) / 1000,
			);
			if (remainingSeconds < MIN_TTL_SECONDS) {
				return deny("ENDED", { startsAt, endsAt });
			}
			const ttlSeconds = Math.min(remainingSeconds, MAX_TTL_SECONDS);

			return {
				ok: true,
				role,
				roomId,
				ttlSeconds,
				startsAt,
				endsAt,
				windowOpensAt,
				windowClosesAt,
				booking: null,
				session: null,
				unifiedBooking,
				hostLiveAt: unifiedBooking.hostLiveAt || null,
				klass: null,
			};
		}

		if (!nutriBooking) {
			return deny("NO_SCHEDULE");
		}

		const userRoleNorm = normalizeRole(user.role);
		const isHostRole =
			userRoleNorm === "admin" ||
			userRoleNorm === "nutritionist" ||
			userRoleNorm === "frontdesk" ||
			(nutriBooking.assignedNutritionistId &&
				String(nutriBooking.assignedNutritionistId) === String(rawUserId));
		const isMember = String(nutriBooking.userId) === String(rawUserId);

		if (!isHostRole && !isMember) {
			return deny("NO_BOOKING");
		}

		const role: SessionRole = isHostRole ? "host" : "member";

		if (nutriBooking.status === "REJECTED" || nutriBooking.status === "CANCELLED") {
			return deny("CANCELLED");
		}
		if (nutriBooking.status === "COMPLETED") {
			return deny("ENDED");
		}

		// Paired — see combineSessionWindow. A late-evening consult would
		// otherwise resolve an end before its own start.
		// A nutritionist booking carries no branch of its own, so the member's
		// home club decides the zone; resolveTimeZone falls back to IST.
		const nutriWindow = combineSessionWindow(
			nutriBooking.bookingDate,
			nutriBooking.startTime,
			nutriBooking.endTime,
			await resolveTimeZone({ userId: nutriBooking.userId }),
		);
		const startsAt = nutriWindow.startsAt;
		const endsAt = nutriWindow.endsAt || new Date((startsAt?.getTime() ?? Date.now()) + 30 * 60_000);

		if (!startsAt) {
			return deny("NO_SCHEDULE");
		}

		const hostLeadMs = 30 * 60_000;
		const memberLeadMs = 5 * 60_000;
		const windowOpensAt = new Date(
			startsAt.getTime() - (role === "host" ? hostLeadMs : memberLeadMs),
		);
		const windowClosesAt = new Date(endsAt.getTime() + 30 * 60_000);

		if (now.getTime() < windowOpensAt.getTime()) {
			return deny("NOT_OPEN_YET", { startsAt, endsAt });
		}
		if (now.getTime() >= windowClosesAt.getTime()) {
			return deny("ENDED", { startsAt, endsAt });
		}

		// Host presence check: Member cannot enter until host has joined/started
		if (role === "member" && !nutriBooking.hostLiveAt) {
			return deny("HOST_NOT_STARTED", { startsAt, endsAt });
		}

		const roomId = nutriBooking.zegoRoomId || `nutri_session_${nutriBooking._id}`;
		const remainingSeconds = Math.floor(
			(windowClosesAt.getTime() - now.getTime()) / 1000,
		);
		if (remainingSeconds < MIN_TTL_SECONDS) {
			return deny("ENDED", { startsAt, endsAt });
		}
		const ttlSeconds = Math.min(remainingSeconds, MAX_TTL_SECONDS);

		return {
			ok: true,
			role,
			roomId,
			ttlSeconds,
			startsAt,
			endsAt,
			windowOpensAt,
			windowClosesAt,
			booking: null,
			session: null,
			nutritionistBooking: nutriBooking,
			hostLiveAt: nutriBooking.hostLiveAt || null,
			klass: null,
		};
	}

	// 2. Host identity: the class's designated host, or an admin operator.
	const isInstructor =
		!!klass?.instructorUserId &&
		String(klass.instructorUserId) === String(rawUserId);
	const userRoleNorm = normalizeRole(user.role);
	const isAdminOrFrontdesk = userRoleNorm === "admin" || userRoleNorm === "frontdesk";
	const role: SessionRole = isInstructor || isAdminOrFrontdesk ? "host" : "member";

	// 3. Session-level lifecycle. Once COMPLETED, it stays over for everyone —
	// re-opening a finished class is a new session, not a re-join.
	if (session?.status === "CANCELLED") {
		return deny("CANCELLED");
	}
	if (session?.status === "COMPLETED") {
		return deny("ENDED");
	}

	// 4. Absolute start/end, fail closed on anything unparseable. Paired so a
	// class running past midnight ends on the following day.
	const sessionWindow = session
		? combineSessionWindow(
				session.sessionDate,
				session.startTime,
				session.endTime,
				// The class's branch owns the meaning of its "HH:mm"; the caller's
				// home club is the fallback, IST the last resort.
				await resolveTimeZone({
					locationId: klass?.locationId,
					userId: rawUserId,
				}),
			)
		: { startsAt: null, endsAt: null };
	const startsAt = sessionWindow.startsAt;
	const endsAtRaw = sessionWindow.endsAt;

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
			.populate("sessionId", "sessionDate startTime endTime status videoRoomId");

		const isOpenToAll = (klass as any)?.access === "open_to_all";
		if (!booking && !isOpenToAll) {
			return deny("NO_BOOKING");
		}

		const bookingSessionObj =
			booking && typeof booking.sessionId === "object" && booking.sessionId
				? (booking.sessionId as unknown as { status?: string })
				: null;
		if (bookingSessionObj?.status === "CANCELLED") {
			return deny("CANCELLED");
		}
	}

	// 6. Role-scoped join window — the only place lead/grace times are read.
	// The class may widen the host's lead beyond the platform default; the
	// lifecycle job reads the same override when it provisions the room, so the
	// room is always ready by the time the host's window opens.
	// `typeof === "number"`, not `Number.isFinite(Number(...))`: a stored `null`
	// coerces to 0, which would silently collapse the host's 30-minute lead to
	// "start time exactly". An explicit 0 from the admin is still honoured.
	const leadMinutes =
		typeof klass?.occurrenceLeadMinutes === "number" &&
		Number.isFinite(klass.occurrenceLeadMinutes)
			? klass.occurrenceLeadMinutes
			: ROOM_LEAD_MINUTES;
	const window = buildJoinWindow(startsAt, endsAt, role, leadMinutes);
	if (now.getTime() < window.opensAt.getTime()) {
		return deny("NOT_OPEN_YET", { startsAt, endsAt });
	}
	if (now.getTime() >= window.closesAt.getTime()) {
		return deny("ENDED");
	}

	// 6.5. A member cannot enter a room the host has never joined — otherwise
	// the join window alone lets a booked member land in an empty room at
	// T-5 with nobody else there. Hosts are exempt: they are the ones whose
	// presence this very check is waiting on. Deliberately placed after the
	// time window (a member 40 minutes early sees NOT_OPEN_YET, not this) and
	// before room resolution. hostLiveAt is write-once — see
	// ScheduledSession.hostLiveAt and POST .../host-presence — so once a
	// class has gone live this never re-blocks a member mid-session even if
	// the host's connection drops.
	if (role === "member" && !session?.hostLiveAt) {
		return deny("HOST_NOT_STARTED", { startsAt, endsAt });
	}

	// 7. Room id — deterministic per session, same for every participant.
	// resolveSessionRoomId is the only implementation; see its doc comment for
	// why neither the caller's booking nor `streamRoomId` may influence this.
	const roomId = resolveSessionRoomId(session);

	if (!roomId) {
		return deny("NO_ROOM");
	}

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
		hostLiveAt: session?.hostLiveAt ?? null,
	};
};

export type RoomMessageAccessResult =
	| { ok: true; role: SessionRole }
	| { ok: false; status: number; message: string };

/**
 * Authorization for *reading* a session's persisted room-chat history —
 * deliberately time-window-free, unlike resolveSessionAccess above.
 *
 * Chat history must stay reachable long after a session's join window (or
 * even the session itself) has closed — a host reviewing what was said, or
 * reconnecting right at the boundary, must not be blocked by the same
 * ENDED/NOT_OPEN_YET gates that protect the live room. What must still hold
 * is that only an actual participant (the class's host, an admin, or a
 * member with a non-cancelled booking / an open-to-all class) can read it.
 */
export const resolveRoomMessageAccess = async ({
	sessionId,
	user,
}: {
	sessionId: string;
	user: AuthenticatedUser;
}): Promise<RoomMessageAccessResult> => {
	const rawUserId = user.id;
	const userObjId = mongoose.Types.ObjectId.isValid(String(rawUserId))
		? new mongoose.Types.ObjectId(String(rawUserId))
		: null;
	const sessionObjId = mongoose.Types.ObjectId.isValid(sessionId)
		? new mongoose.Types.ObjectId(sessionId)
		: null;

	const session = sessionObjId
		? await ScheduledSession.findById(sessionObjId).select("classId").lean()
		: null;

	const klass = session
		? await ClassModel.findById(session.classId).select("instructorUserId access").lean()
		: await ClassModel.findById(sessionId).select("instructorUserId access").lean();

	if (!session && !klass) {
		const cleanId = sessionId.startsWith("session_")
			? sessionId.replace("session_", "")
			: sessionId.startsWith("nutri_session_")
				? sessionId.replace("nutri_session_", "")
				: sessionId;

		let unifiedBooking: any = null;
		let nutriBooking: any = null;

		if (mongoose.Types.ObjectId.isValid(cleanId)) {
			unifiedBooking = await UnifiedBooking.findById(cleanId).lean();
			if (!unifiedBooking) {
				nutriBooking = await NutritionistBooking.findById(cleanId).lean();
			}
		}

		if (!unifiedBooking && !nutriBooking) {
			unifiedBooking = await UnifiedBooking.findOne({ zegoRoomId: sessionId }).lean();
			if (!unifiedBooking) {
				nutriBooking = await NutritionistBooking.findOne({ zegoRoomId: sessionId }).lean();
			}
		}

		if (unifiedBooking) {
			const userRoleNorm = normalizeRole(user.role);
			const isHostRole =
				userRoleNorm === "admin" ||
				userRoleNorm === "frontdesk" ||
				userRoleNorm === "staff" ||
				(unifiedBooking.expertId &&
					String(unifiedBooking.expertId) === String(rawUserId));
			const isMember = String(unifiedBooking.userId) === String(rawUserId);

			if (!isHostRole && !isMember) {
				return { ok: false, status: 403, message: "You do not have access to this session's messages." };
			}
			return { ok: true, role: isHostRole ? "host" : "member" };
		}

		if (!nutriBooking) {
			return { ok: false, status: 404, message: "Session not found." };
		}

		const userRoleNorm = normalizeRole(user.role);
		const isHostRole =
			userRoleNorm === "admin" ||
			userRoleNorm === "nutritionist" ||
			userRoleNorm === "frontdesk" ||
			(nutriBooking.assignedNutritionistId &&
				String(nutriBooking.assignedNutritionistId) === String(rawUserId));
		const isMember = String(nutriBooking.userId) === String(rawUserId);

		if (!isHostRole && !isMember) {
			return { ok: false, status: 403, message: "You do not have access to this session's messages." };
		}
		return { ok: true, role: isHostRole ? "host" : "member" };
	}

	const isInstructor =
		!!klass?.instructorUserId && String(klass.instructorUserId) === String(rawUserId);
	const isAdmin = normalizeRole(user.role) === "admin";
	if (isInstructor || isAdmin) {
		return { ok: true, role: "host" };
	}

	const isOpenToAll = (klass as any)?.access === "open_to_all";
	const booking = await Booking.findOne({
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
	}).lean();

	if (booking || isOpenToAll) {
		return { ok: true, role: "member" };
	}

	return { ok: false, status: 403, message: "You do not have access to this session's messages." };
};
