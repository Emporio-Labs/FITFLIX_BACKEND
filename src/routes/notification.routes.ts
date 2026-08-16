import { Router } from "express";
import {
	broadcastToTopic,
	listNotifications,
	markAllRead,
	markNotificationRead,
	registerToken,
} from "../controllers/notification.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();
router.use(authenticateToken);

router.get("/", listNotifications);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markNotificationRead);
router.post("/fcm-token", registerToken);
// Admin-only campaign broadcast — see fcm.service.ts sendPushToTopic for why
// this scales to millions of devices with no per-user server work.
router.post("/broadcast", authorize(["admin"]), broadcastToTopic);

export default router;
