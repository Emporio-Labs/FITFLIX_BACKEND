import { Router } from "express";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware } from "../middleware/upload.middleware";
import { createEvent, getEvents, uploadEventImage } from "../controllers/event.controller";

const router = Router();

/**
 * GET /events / GET /api/v1/events
 * Protected: Admin and FrontDesk staff only
 */
router.get(
	"/",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	getEvents,
);

/**
 * POST /events/upload-image
 * Upload cover image for an event
 */
router.post(
	"/upload-image",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	uploadMiddleware.single("image"),
	uploadEventImage,
);

/**
 * POST /events / POST /api/v1/events
 * Protected: Admin and FrontDesk staff only
 */
router.post(
	"/",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	createEvent,
);

export default router;
