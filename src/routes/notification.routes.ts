import { Router } from "express";
import {
	listNotifications,
	markAllRead,
	markNotificationRead,
	registerToken,
} from "../controllers/notification.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const router = Router();
router.use(authenticateToken);

router.get("/", listNotifications);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markNotificationRead);
router.post("/fcm-token", registerToken);

export default router;
