import { Router } from "express";
import {
	deleteRecording,
	getReplayPlayback,
	listAdminRecordings,
	listMemberReplays,
	streamReplay,
	updateRecordingVisibility,
} from "../controllers/recording.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

export const recordingRouter = Router();

// Member replay endpoints
// FX-23.2: Replay listing for member app
recordingRouter.get("/replays", authenticateToken, listMemberReplays);

// FX-23.3: Playback URL generation with membership check & short-lived signed token
recordingRouter.get("/:id/playback", authenticateToken, getReplayPlayback);

// FX-23.5: Signed playback stream (supports external playback link with token param)
recordingRouter.get("/:id/stream", streamReplay);

// Admin endpoints mounted under /recordings/admin...
recordingRouter.get(
	"/admin",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	listAdminRecordings,
);
recordingRouter.patch(
	"/admin/:id/visibility",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	updateRecordingVisibility,
);
recordingRouter.delete(
	"/admin/:id",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	deleteRecording,
);

// Standalone admin router for /api/v1/admin/recordings mount
export const adminRecordingRouter = Router();
adminRecordingRouter.use(authenticateToken);
adminRecordingRouter.use(authorize(["admin", "frontdesk"]));
adminRecordingRouter.get("/", listAdminRecordings);
adminRecordingRouter.patch("/:id/visibility", updateRecordingVisibility);
adminRecordingRouter.delete("/:id", deleteRecording);

export default recordingRouter;
