import type { RequestHandler } from "express";
import Booking from "../models/Bookings";
import User from "../models/User";
import { generateToken04 } from "../utils/zego";
import {
	buildJoinWindow,
	combineSessionDateTime,
	nonCancelledBookingStatusFilter,
	resolveRoomIdFromBooking,
	sanitizeRoomId,
} from "../utils/zego-room";
import { videoTokenParamsSchema } from "../validators/zego.validator";

/// Login-room + publish-stream. Scoped to a single room_id by the caller.
const ROOM_PRIVILEGE = { 1: 1, 2: 1 } as const;

const TOKEN_TTL_SECONDS = 7200;

type ZegoConfig = { appID: number; serverSecret: string };

const readZegoConfig = (): ZegoConfig | { error: string; status: number } => {
	const appIDStr = process.env.ZEGO_APP_ID;
	const serverSecret = process.env.ZEGO_SERVER_SECRET;

	if (!appIDStr || !serverSecret) {
		return {
			status: 503,
			error: "ZEGOCLOUD token service is not configured on this server.",
		};
	}

	const appID = Number(appIDStr);
	if (!Number.isFinite(appID) || appID <= 0) {
		return { status: 500, error: "Invalid ZEGO_APP_ID configuration" };
	}

	return { appID, serverSecret };
};

const mintRoomToken = (
	config: ZegoConfig,
	userId: string,
	roomId: string,
	ttlSeconds: number,
): { token: string; expiresAt: string } => {
	// Binding room_id is what stops a token being a skeleton key for every room
	// in the project — an unbound token authenticates the *user*, not the room.
	const payload = JSON.stringify({
		room_id: roomId,
		privilege: ROOM_PRIVILEGE,
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
		expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
	};
};

/**
 * POST /api/v1/zego/sessions/:sessionId/token
 *
 * Issues a Zego token for a session the caller actually holds a live booking
 * for. Authorization is the whole point of this endpoint: the room ID is
 * derived from that booking rather than accepted from the request, so a caller
 * cannot mint credentials for a room they were never admitted to.
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

		const { sessionId } = parsedParams.data;

		// The booking is the authorization record: it ties this user to this
		// session and carries the cancellation state.
		const booking = await Booking.findOne({
			user: user.id,
			$or: [{ sessionId }, { classId: sessionId }],
			status: nonCancelledBookingStatusFilter,
		})
			.populate("sessionId", "sessionDate startTime endTime status videoRoomId")
			.populate("classId", "zegoRoomId");

		if (!booking) {
			// Deliberately not distinguishing "no booking" from "session does not
			// exist" — that difference would let a caller probe for valid ids.
			res.status(403).json({
				message: "No active booking found for this session.",
			});
			return;
		}

		const sessionObj =
			typeof booking.sessionId === "object" && booking.sessionId
				? (booking.sessionId as any)
				: null;
		const sessionDate = sessionObj?.sessionDate || (booking as any).bookingDate;
		const startTime = sessionObj?.startTime || (booking as any).startTime;
		const endTime = sessionObj?.endTime || (booking as any).endTime;

		if (sessionObj?.status === "CANCELLED") {
			res.status(409).json({ message: "This session has been cancelled." });
			return;
		}

		const start = combineSessionDateTime(sessionDate, startTime);
		if (!start) {
			res.status(409).json({
				message: "This session has no valid schedule; cannot issue a token.",
			});
			return;
		}
		const end = combineSessionDateTime(sessionDate, endTime);

		const { opensAt, closesAt } = buildJoinWindow(start, end);
		const now = new Date();

		if (now < opensAt) {
			res.status(403).json({
				message: "This session is not open to join yet.",
				opensAt: opensAt.toISOString(),
			});
			return;
		}
		if (now > closesAt) {
			res.status(403).json({ message: "This session has already ended." });
			return;
		}

		const rawRoomId = resolveRoomIdFromBooking(
			booking.toObject() as Record<string, unknown>,
		);
		if (!rawRoomId) {
			res
				.status(409)
				.json({ message: "No video room is available for this session." });
			return;
		}
		const roomId = sanitizeRoomId(rawRoomId);

		// Never outlive the join window — a token valid long after the session is
		// a standing invitation to a room.
		const ttlSeconds = Math.min(
			TOKEN_TTL_SECONDS,
			Math.max(60, Math.ceil((closesAt.getTime() - now.getTime()) / 1000)),
		);

		const { token, expiresAt } = mintRoomToken(
			config,
			user.id,
			roomId,
			ttlSeconds,
		);

		const profile = await User.findById(user.id).select("username").lean();

		res.status(200).json({
			appID: config.appID,
			token,
			roomId,
			userID: user.id,
			userName:
				(profile as { username?: string } | null)?.username ?? "Member",
			expiresAt,
		});
	} catch (error) {
		console.error("Zego session token generation error:", error);
		next(error);
	}
};
