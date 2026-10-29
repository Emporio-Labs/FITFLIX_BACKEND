import { Router } from "express";
import { authenticateToken, optionalAuthenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware } from "../middleware/upload.middleware";
import {
	createEvent,
	deleteEvent,
	getDigitalPassByTicketId,
	getEventById,
	getEvents,
	getEventRegistrations,
	getPublicEventBySlug,
	registerForEvent,
	toggleRegistrationCheckIn,
	updateEvent,
	uploadEventImage,
} from "../controllers/event.controller";

const router = Router();

/**
 * GET /events/public/:slug / GET /api/v1/events/public/:slug
 * Public: Anyone can fetch published event landing details
 */
router.get("/public/:slug", getPublicEventBySlug);

/**
 * POST /events/:slug/register / POST /api/v1/events/:slug/register
 * Public / Member Registration: Book a ticket tier pass
 */
router.post("/:slug/register", optionalAuthenticateToken, registerForEvent);

/**
 * GET /events/pass/:ticketId / GET /api/v1/events/pass/:ticketId
 * Public: Retrieve digital ticket pass details and signed QR payload
 */
router.get("/pass/:ticketId", getDigitalPassByTicketId);

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
 * GET /events/:id/registrations
 * Protected: Admin and FrontDesk staff only
 */
router.get(
	"/:id/registrations",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	getEventRegistrations,
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
 * PATCH /events/registrations/:id/toggle-checkin
 * Protected: Admin and FrontDesk staff only
 * Manual check-in toggle for attendee roster
 */
router.patch(
	"/registrations/:id/toggle-checkin",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	toggleRegistrationCheckIn,
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
