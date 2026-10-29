import { Router } from "express";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware } from "../middleware/upload.middleware";
import {
	createEvent,
	deleteEvent,
	getEventById,
	getEvents,
	updateEvent,
	uploadEventImage,
} from "../controllers/event.controller";

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
 * GET /events/:id
 * Protected: Admin and FrontDesk staff only
 */
router.get(
	"/:id",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	getEventById,
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

/**
 * PATCH /events/:id
 * Protected: Admin and FrontDesk staff only
 */
router.patch(
	"/:id",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	updateEvent,
);

/**
 * DELETE /events/:id
 * Protected: Admin only
 */
router.delete(
	"/:id",
	authenticateToken,
	authorize(["admin"]),
	deleteEvent,
);

export default router;
