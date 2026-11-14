import { Router } from "express";
import {
	broadcastToTopic,
	getMemberPreferences,
	getWebPushVapidKey,
	listMyWebPushSubscriptions,
	listNotifications,
	markAllRead,
	markNotificationRead,
	registerToken,
	registerWebPushSubscription,
	removeWebPushSubscription,
	sendTestNotificationPush,
	sendWebPushTest,
	updateMemberPreferences,
	updateWebPushPreferences,
} from "../controllers/notification.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();
router.use(authenticateToken);

// Member notification inbox & preferences (Im-6)
router.get("/", listNotifications);
router.get("/preferences", getMemberPreferences);
router.patch("/preferences", updateMemberPreferences);
router.post("/test-push", sendTestNotificationPush);
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
