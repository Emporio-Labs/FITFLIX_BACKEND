import express from "express";
import {
	bookPersonalTraining,
	cancelBookingHandler,
	completeBookingAdmin,
	getAllBookingsAdmin,
	getBookingById,
	getMyBookings,
	getMyPtPackage,
	getTrainerAvailability,
	getTrainerChangeRequestsAdmin,
	getTrainers,
	getTrainerSchedule,
	resolveTrainerChangeRequestAdmin,
	submitTrainerChangeRequest,
	updateTrainerScheduleHandler,
} from "../controllers/unified-booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = express.Router();

// ── Public / Semi-Public Discovery ──
router.get("/trainers", getTrainers);
router.get("/trainers/:id/availability", getTrainerAvailability);
router.get("/trainers/:id/schedule", getTrainerSchedule);

// ── Authenticated Trainer Schedule Update ──
router.put(
	"/trainers/:id/schedule",
	authenticateToken,
	authorize(["admin", "frontdesk", "trainer"]),
	updateTrainerScheduleHandler,
);

// ── Member Personal Training Operations ──
router.get("/my-package", authenticateToken, getMyPtPackage);
router.post("/bookings", authenticateToken, bookPersonalTraining);
router.get("/my-bookings", authenticateToken, getMyBookings);
router.get("/bookings/:id", authenticateToken, getBookingById);
router.post("/bookings/:id/cancel", authenticateToken, cancelBookingHandler);
router.post(
	"/trainer-change-request",
	authenticateToken,
	submitTrainerChangeRequest,
);

// ── Frontdesk & Admin Operations ──
router.get(
	"/admin/bookings",
	authenticateToken,
	authorize(["admin", "frontdesk", "staff", "trainer"]),
	getAllBookingsAdmin,
);
router.post(
	"/admin/bookings/:id/complete",
	authenticateToken,
	authorize(["admin", "frontdesk", "staff", "trainer"]),
	completeBookingAdmin,
);
router.get(
	"/admin/trainer-change-requests",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	getTrainerChangeRequestsAdmin,
);
router.post(
	"/admin/trainer-change-requests/:id/resolve",
	authenticateToken,
	authorize(["admin", "frontdesk"]),
	resolveTrainerChangeRequestAdmin,
);

export default router;
