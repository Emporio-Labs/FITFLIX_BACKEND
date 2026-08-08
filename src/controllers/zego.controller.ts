import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Booking from "../models/Bookings";
import User from "../models/User";
import { nonCancelledBookingStatusFilter } from "../utils/zego-room";
import { generateToken04 } from "../utils/zego";
import {
	resolveSessionAccess,
	type SessionAccessDenied,
} from "../services/session-access.service";
import { forceDisconnectRoom } from "../services/zego-server-api.service";
import { videoTokenParamsSchema } from "../validators/zego.validator";

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
		if (access.booking && !access.booking.joinedAt) {
			access.booking.joinedAt = new Date();
			await access.booking.save();
		}

		res.status(200).json({
			token,
			appID: config.appID,
			roomId: access.roomId,
			userId: user.id,
			userName: displayName,
			role: access.role,
			expiresAt: expiresAt.toISOString(),
			roomOpensAt: access.windowOpensAt.toISOString(),
			sessionEndsAt: access.endsAt.toISOString(),
			windowClosesAt: access.windowClosesAt.toISOString(),
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

		// Flip to COMPLETED before kicking, so a kicked client that instantly
		// retries /token races against a closed door, not an open one.
		access.session.status = "COMPLETED";
		access.session.endedAt = new Date();
		if (mongoose.Types.ObjectId.isValid(user.id)) {
			access.session.endedBy = new mongoose.Types.ObjectId(user.id);
		}
		await access.session.save();

		const attendanceResult = await Booking.updateMany(
			{
				$or: [
					{ sessionId },
					...(access.session._id ? [{ sessionId: String(access.session._id) }] : []),
				],
				joinedAt: { $ne: null },
				status: nonCancelledBookingStatusFilter,
			},
			{ $set: { status: "Attended", leftAt: new Date() } },
		);

		let kicked: string[] = [];
		let kickErrors: Array<{ userIds: string[]; message: string }> = [];

		const config = readZegoConfig();
		if (!("error" in config)) {
			try {
				const result = await forceDisconnectRoom(
					{ appId: config.appID, serverSecret: config.serverSecret },
					access.roomId,
					"Class ended by host",
				);
				kicked = result.kicked;
				kickErrors = result.errors;
			} catch (error) {
				// Best-effort — Zego being unreachable must never block ending a
				// class. The COMPLETED flip above is what actually closes it.
				kickErrors = [
					{
						userIds: [],
						message: error instanceof Error ? error.message : String(error),
					},
				];
			}
		}

		res.status(200).json({
			message: "Session ended.",
			attendanceMarked: attendanceResult.modifiedCount,
			kicked,
			kickErrors,
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

