import type { RequestHandler } from "express";
import User from "../models/User";
import RoomMessage from "../models/RoomMessage";
import { generateToken04 } from "../utils/zego";
import { resolveSessionRoomId } from "../utils/zego-room";
import {
	resolveSessionAccess,
	resolveRoomMessageAccess,
	type SessionAccessDenied,
} from "../services/session-access.service";
import { finalizeSession } from "../services/session-finalize.service";
import {
	videoTokenParamsSchema,
	sendRoomMessageBodySchema,
	listRoomMessagesQuerySchema,
} from "../validators/zego.validator";

/// Login-room + publish-stream, granted to hosts and to every member of a
/// group video call. A live-stream *member* (audience) gets login only —
/// {2: 0} — so a patched client still can't start publishing into someone
/// else's broadcast.
const FULL_PRIVILEGE = { 1: 1, 2: 1 } as const;
const AUDIENCE_PRIVILEGE = { 1: 1, 2: 0 } as const;

type ZegoConfig = { appID: number; serverSecret: string };

const readZegoConfig = (): ZegoConfig | { error: string; status: number } => {
	const appIDStr = process.env.ZEGO_APP_ID;
	const serverSecret = process.env.ZEGO_SERVER_SECRET;

	if (!appIDStr || !serverSecret) {
		return {
			error:
				"ZEGOCLOUD is not configured on the server. Contact your system administrator.",
			status: 503,
		};
	}

	const appID = Number.parseInt(appIDStr, 10);
	if (Number.isNaN(appID)) {
		return {
			error: "Server configuration error: ZEGO_APP_ID must be a integer.",
			status: 500,
		};
	}

	return { appID, serverSecret };
};

const mintRoomToken = (
	config: ZegoConfig,
	userId: string,
	userName: string,
	roomId: string,
	ttlSeconds: number,
	privilege: typeof FULL_PRIVILEGE | typeof AUDIENCE_PRIVILEGE,
): { token: string; expiresAt: Date } => {
	// Binding room_id is what stops a token being a skeleton key for every room
	// in the project — an unbound token authenticates the *user*, not the room.
	const payload = JSON.stringify({
		room_id: roomId,
		privilege,
		user_name: userName,
	});

	const token = generateToken04(
		config.appID,
		userId,
		config.serverSecret,
		ttlSeconds,
		payload,
	);

	return {
		token,
		expiresAt: new Date(Date.now() + ttlSeconds * 1000),
	};
};

/// ZIM (the signaling channel co-host invitations ride on) is a separate
/// login from RTC and rejects a room-bound payload — it wants an empty one.
/// Deliberately not reusing mintRoomToken's token for this: that one is
/// scoped to a single room by design (see the comment above), and ZIM login
/// happens once per user session, independent of which room they're in.
const mintZimToken = (
	config: ZegoConfig,
	userId: string,
	ttlSeconds: number,
): string =>
	generateToken04(config.appID, userId, config.serverSecret, ttlSeconds, "");

/// `req.user` is a JWT-derived {id, email, role} — no display name. Load the
/// member document for one; hosts authenticating as admin/trainer accounts
/// may have no matching User doc, so fall back to the email's local part.
const resolveDisplayName = async (
	userId: string,
	email: string | undefined,
	fallback: string,
): Promise<string> => {
	const doc = await User.findById(userId).select("username").lean();
	if (doc?.username) return doc.username;
	if (email) return email.split("@")[0] || fallback;
	return fallback;
};

const respondDenied = (res: Parameters<RequestHandler>[1], access: SessionAccessDenied) => {
	res.status(access.status).json({
		message: access.message,
		code: access.code,
		startsAt: access.startsAt ? access.startsAt.toISOString() : undefined,
		endsAt: access.endsAt ? access.endsAt.toISOString() : undefined,
	});
};

/**
 * POST /api/v1/zego/sessions/:sessionId/token
 *
 * Issues a Zego token scoped to exactly one room, for exactly as long as the
 * caller's join window for this session remains open. All authorization,
 * role, and timing logic lives in `resolveSessionAccess` — this handler only
 * translates its verdict into a token or an error.
 */
export const generateSessionToken: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse(req.params);
		if (!parsedParams.success) {
			res.status(400).json({
				message: "Invalid session id",
				errors: parsedParams.error.issues,
			});
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const config = readZegoConfig();
		if ("error" in config) {
			res.status(config.status).json({ message: config.error });
			return;
		}

		const access = await resolveSessionAccess({
			sessionId: parsedParams.data.sessionId,
			user,
		});

		if (!access.ok) {
			respondDenied(res, access);
			return;
		}

		const displayName = await resolveDisplayName(
			user.id,
			user.email,
			access.role === "host" ? "Host" : "Member",
		);

		const isAudienceMember =
			access.role === "member" && access.klass?.sessionType === "live_stream";
		const privilege = isAudienceMember ? AUDIENCE_PRIVILEGE : FULL_PRIVILEGE;

		const { token, expiresAt } = mintRoomToken(
			config,
			user.id,
			displayName,
			access.roomId,
			access.ttlSeconds,
			privilege,
		);

		// Robust half of "member sees that they attended" — a client killed
		// mid-class never runs its own dispose()-time attendance report, so
		// stamping this the moment a token is actually handed out means
		// attendance survives even a crash.
		if (access.role === "member" && !access.booking && access.session) {
			try {
				const { default: Booking } = await import("../models/Bookings");
				access.booking = await Booking.create({
					user: user.id,
					sessionId: String(access.session._id),
					classId: String(access.session.classId),
					bookingDate: access.session.sessionDate,
					startTime: access.session.startTime,
					endTime: access.session.endTime,
					status: "Attended",
					joinedAt: new Date(),
					creditsBypassed: true,
					creditCostSnapshot: 0,
				});
			} catch (err) {
				console.error("[zego] Failed to auto-create open_to_all booking:", err);
			}
		} else if (access.booking && !access.booking.joinedAt) {
			access.booking.joinedAt = new Date();
			await access.booking.save();
		}

		// Only live streams use ZIM (co-host invitations); minting it for every
		// session would be one more token the client never uses.
		const zimToken =
			access.klass?.sessionType === "live_stream"
				? mintZimToken(config, user.id, access.ttlSeconds)
				: undefined;

		res.status(200).json({
			token,
			zimToken,
			appID: config.appID,
			roomId: access.roomId,
			userId: user.id,
			userName: displayName,
			role: access.role,
			expiresAt: expiresAt.toISOString(),
			roomOpensAt: access.windowOpensAt.toISOString(),
			sessionEndsAt: access.endsAt.toISOString(),
			windowClosesAt: access.windowClosesAt.toISOString(),
			hostLiveAt: access.hostLiveAt ? access.hostLiveAt.toISOString() : null,
		});
	} catch (error) {
		console.error("Zego session token generation error:", error);
		next(error);
	}
};

/**
 * POST /api/v1/zego/sessions/:sessionId/end
 *
 * Host-only. Flips the session to COMPLETED (closing the join window to
 * everyone, including the host, on any future call), backfills attendance
 * for whoever's booking shows they joined, then best-effort kicks anyone
 * still connected via ZegoCloud's REST API — the DB flip is what actually
 * matters; the kick just makes it happen sooner than "eventually leaves".
 */
export const endLiveSession: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse({
			sessionId: req.params.sessionId,
		});
		if (!parsedParams.success) {
			res.status(400).json({
				message: "Invalid session id",
				errors: parsedParams.error.issues,
			});
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { sessionId } = parsedParams.data;

		const access = await resolveSessionAccess({ sessionId, user });

		// Idempotent: a retried "End" click after the first one already
		// succeeded must not surface as an error toast.
		if (!access.ok) {
			if (access.code === "ENDED") {
				res.status(200).json({
					message: "Session already ended.",
					attendanceMarked: 0,
					kicked: [] as string[],
					kickErrors: [] as Array<{ userIds: string[]; message: string }>,
				});
				return;
			}
			respondDenied(res, access);
			return;
		}

		if (access.role !== "host") {
			res.status(403).json({ message: "Only the host can end this class." });
			return;
		}

		if (!access.session) {
			res.status(409).json({ message: "This session has no schedule to end." });
			return;
		}

		const config = readZegoConfig();
		const result = await finalizeSession(access.session, {
			endedBy: user.id,
			reason: "Class ended by host",
			zegoConfig: "error" in config ? null : { appId: config.appID, serverSecret: config.serverSecret },
		});

		res.status(200).json({
			message: "Session ended.",
			...result,
		});
	} catch (error) {
		console.error("Zego end-session error:", error);
		next(error);
	}
};

/**
 * POST /api/v1/zego/sessions/:sessionId/attendance
 *
 * Session-scoped attendance reporting: the caller's own booking is resolved
 * server-side via `resolveSessionAccess`, so there's no booking id for a
 * client to get wrong (or forge) — replaces the id-based
 * POST /bookings/:id/attendance for the Zego join flow specifically.
 */
export const recordSessionAttendance: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse({
			sessionId: req.params.sessionId,
		});
		if (!parsedParams.success) {
			res.status(400).json({
				message: "Invalid session id",
				errors: parsedParams.error.issues,
			});
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		// Attendance can be reported right up to — and slightly past, via the
		// host's overrun grace — the moment the room actually closes, so this
		// intentionally reuses the same access check as the token endpoint
		// rather than a separate "is this booking mine" query.
		const access = await resolveSessionAccess({
			sessionId: parsedParams.data.sessionId,
			user,
			now: new Date(Date.now() - 5 * 60_000), // tolerate a client reporting just after its window closed
		});

		if (!access.ok && access.code !== "ENDED") {
			respondDenied(res, access);
			return;
		}

		if (!access.ok || !access.booking) {
			// Hosts have no booking to mark; nothing to record.
			res.status(200).json({ message: "No booking to record attendance for." });
			return;
		}

		const stayDurationMinutes = Number(req.body?.stayDurationMinutes ?? 0);
		const booking = access.booking;

		booking.status = "Attended";
		booking.joinedAt = booking.joinedAt || new Date();
		booking.leftAt = new Date();
		booking.stayDurationMinutes = Math.max(
			booking.stayDurationMinutes || 0,
			Number.isFinite(stayDurationMinutes) ? stayDurationMinutes : 0,
		);

		await booking.save();

		res.status(200).json({ message: "Attendance recorded successfully.", booking });
	} catch (error) {
		console.error("Zego session attendance error:", error);
		next(error);
	}
};

/**
 * POST /api/v1/zego/sessions/:sessionId/host-presence
 *
 * Host-only heartbeat: called from the host client's real "I am now in the
 * room" callback (Zego's onJoinRoom / onLiveStart), not from token issuance —
 * a host who requests a token but never actually joins must not flip members
 * into the room. Safe to call repeatedly; `hostLiveAt` is write-once, so a
 * reconnect after a brief drop never resets when the class "started" and
 * never re-blocks members who are already in.
 *
 * This is the fast path. session-room-lifecycle.service.ts's
 * verifyHostPresence sweep is the self-heal for a host whose client dies
 * before ever calling this endpoint.
 */
export const reportHostPresence: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse({
			sessionId: req.params.sessionId,
		});
		if (!parsedParams.success) {
			res.status(400).json({
				message: "Invalid session id",
				errors: parsedParams.error.issues,
			});
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { sessionId } = parsedParams.data;
		const access = await resolveSessionAccess({ sessionId, user });

		if (!access.ok) {
			respondDenied(res, access);
			return;
		}

		if (access.role !== "host") {
			res.status(403).json({ message: "Only the host can report presence for this class." });
			return;
		}

		if (access.nutritionistBooking) {
			const now = new Date();
			if (!access.nutritionistBooking.hostLiveAt) {
				access.nutritionistBooking.hostLiveAt = now;
			}
			access.nutritionistBooking.hostLastSeenAt = now;
			await access.nutritionistBooking.save();

			res.status(200).json({ hostLiveAt: access.nutritionistBooking.hostLiveAt.toISOString() });
			return;
		}

		if (access.unifiedBooking) {
			const now = new Date();
			if (!access.unifiedBooking.hostLiveAt) {
				access.unifiedBooking.hostLiveAt = now;
			}
			access.unifiedBooking.hostLastSeenAt = now;
			await access.unifiedBooking.save();

			res.status(200).json({ hostLiveAt: access.unifiedBooking.hostLiveAt.toISOString() });
			return;
		}

		if (!access.session) {
			res.status(409).json({ message: "This session has no schedule." });
			return;
		}

		const now = new Date();
		if (!access.session.hostLiveAt) {
			access.session.hostLiveAt = now;
		}
		access.session.hostLastSeenAt = now;
		await access.session.save();

		res.status(200).json({ hostLiveAt: access.session.hostLiveAt.toISOString() });
	} catch (error) {
		console.error("Zego host-presence error:", error);
		next(error);
	}
};

/**
 * POST /api/v1/zego/sessions/:sessionId/messages
 *
 * Persists one Room-message send. Uses the same live-window gate as token
 * issuance (resolveSessionAccess) — a message can only be recorded while the
 * sender could actually be in the room, so this can never outlive the
 * session's real end time. Sender identity/role are always resolved
 * server-side from the verified session, never taken from the request body.
 *
 * Idempotent on (sessionId, senderUserId, zegoMessageId): a client retry
 * (e.g. after a flaky response) returns the existing row instead of a 500 or
 * a duplicate.
 */
export const sendRoomMessage: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse(req.params);
		if (!parsedParams.success) {
			res.status(400).json({ message: "Invalid session id", errors: parsedParams.error.issues });
			return;
		}

		const parsedBody = sendRoomMessageBodySchema.safeParse(req.body);
		if (!parsedBody.success) {
			res.status(400).json({ message: "Invalid message", errors: parsedBody.error.issues });
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { sessionId } = parsedParams.data;
		const { body, zegoMessageId, sentAt } = parsedBody.data;

		const access = await resolveSessionAccess({ sessionId, user });
		if (!access.ok) {
			respondDenied(res, access);
			return;
		}

		const senderName = await resolveDisplayName(user.id, user.email, "Member");
		const roomId =
			access.roomId ??
			resolveSessionRoomId(access.session) ??
			sessionId;

		if (zegoMessageId) {
			const existing = await RoomMessage.findOne({
				sessionId,
				senderUserId: user.id,
				zegoMessageId,
			});
			if (existing) {
				res.status(200).json({ message: "Message already recorded.", roomMessage: existing });
				return;
			}
		}

		const roomMessage = await RoomMessage.create({
			sessionId,
			roomId,
			senderUserId: user.id,
			senderName,
			senderRole: access.role,
			body,
			zegoMessageId: zegoMessageId ?? null,
			sentAt: sentAt ?? new Date(),
		});

		res.status(201).json({ message: "Message recorded.", roomMessage });
	} catch (error: any) {
		// A racing duplicate send can lose the findOne-then-create race and hit
		// the unique index instead — treat that the same as the pre-check hit.
		if (error?.code === 11000) {
			try {
				const parsedParams = videoTokenParamsSchema.safeParse(req.params);
				const parsedBody = sendRoomMessageBodySchema.safeParse(req.body);
				if (parsedParams.success && parsedBody.success && req.user?.id && parsedBody.data.zegoMessageId) {
					const existing = await RoomMessage.findOne({
						sessionId: parsedParams.data.sessionId,
						senderUserId: req.user.id,
						zegoMessageId: parsedBody.data.zegoMessageId,
					});
					if (existing) {
						res.status(200).json({ message: "Message already recorded.", roomMessage: existing });
						return;
					}
				}
			} catch {
				// fall through to the generic error handler below
			}
		}
		console.error("Zego send room message error:", error);
		next(error);
	}
};

/**
 * GET /api/v1/zego/sessions/:sessionId/messages
 *
 * Returns persisted chat history for a session, oldest first. Deliberately
 * uses resolveRoomMessageAccess rather than resolveSessionAccess: history
 * must stay readable well after the live join window (or the session
 * itself) has closed — a host rejoining right at the boundary, or reviewing
 * the conversation afterwards, must not be blocked by the same
 * ENDED/NOT_OPEN_YET gates that protect the live room itself.
 */
export const listRoomMessages: RequestHandler = async (req, res, next) => {
	try {
		const parsedParams = videoTokenParamsSchema.safeParse(req.params);
		if (!parsedParams.success) {
			res.status(400).json({ message: "Invalid session id", errors: parsedParams.error.issues });
			return;
		}

		const parsedQuery = listRoomMessagesQuerySchema.safeParse(req.query);
		if (!parsedQuery.success) {
			res.status(400).json({ message: "Invalid query", errors: parsedQuery.error.issues });
			return;
		}

		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { sessionId } = parsedParams.data;
		const access = await resolveRoomMessageAccess({ sessionId, user });
		if (!access.ok) {
			res.status(access.status).json({ message: access.message });
			return;
		}

		const limit = parsedQuery.data.limit ?? 200;
		const messages = await RoomMessage.find({ sessionId })
			.sort({ sentAt: 1, _id: 1 })
			.limit(limit)
			.lean();

		res.status(200).json({ message: "Messages retrieved successfully", count: messages.length, messages });
	} catch (error) {
		console.error("Zego list room messages error:", error);
		next(error);
	}
};

