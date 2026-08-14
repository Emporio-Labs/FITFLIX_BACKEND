import { Router } from "express";
import {
	endLiveSession,
	generateSessionToken,
	listRoomMessages,
	recordSessionAttendance,
	reportHostPresence,
	sendRoomMessage,
} from "../controllers/zego.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { chatRateLimit } from "../middleware/rate-limit.middleware";

const zegoRouter = Router();

// Apply JWT token authentication for all Zego routes
zegoRouter.use(authenticateToken);

// The room is derived from the caller's booking for :sessionId. There is
// deliberately no endpoint that mints a token for a client-supplied room id —
// that would hand any authenticated user the keys to every room in the project.
zegoRouter.post("/sessions/:sessionId/token", generateSessionToken);

// No authorize(["admin"]) here on purpose — "host" is resolved per-session
// inside resolveSessionAccess (instructorUserId match, or an admin operator),
// so an instructor can end their own class without needing admin rights.
zegoRouter.post("/sessions/:sessionId/end", endLiveSession);

zegoRouter.post("/sessions/:sessionId/attendance", recordSessionAttendance);

// Host-only; resolveSessionAccess rejects a non-host caller with 403 before
// this ever writes anything.
zegoRouter.post("/sessions/:sessionId/host-presence", reportHostPresence);

// Room-chat persistence. POST is far higher frequency than the routes above
// (one call per message, not per join), so it gets its own per-user budget
// rather than sharing the general apiRateLimit.
zegoRouter.post(
	"/sessions/:sessionId/messages",
	chatRateLimit,
	sendRoomMessage,
);
zegoRouter.get("/sessions/:sessionId/messages", listRoomMessages);

export default zegoRouter;
