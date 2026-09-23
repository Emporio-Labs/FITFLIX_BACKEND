import { Router } from "express";
import {
	broadcastToTopic,
	getWebPushVapidKey,
	listMyWebPushSubscriptions,
	listNotifications,
	markAllRead,
	markNotificationRead,
	registerToken,
	registerWebPushSubscription,
	removeWebPushSubscription,
	sendWebPushTest,
	updateWebPushPreferences,
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

// FX-25 · Web Push (VAPID) endpoints for the staff PWA (frontdesk-fitflix).
router.get("/vapid-key", getWebPushVapidKey);
router.get("/web-push/subscriptions", listMyWebPushSubscriptions);
router.post("/web-push/subscriptions", registerWebPushSubscription);
router.delete("/web-push/subscriptions/:endpoint", removeWebPushSubscription);
router.patch("/web-push/preferences", updateWebPushPreferences);
router.post("/web-push/test", sendWebPushTest);

export default router;
