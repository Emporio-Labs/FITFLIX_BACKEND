import { Router } from "express";
import {
	acceptBooking,
	completeBooking,
	getAllBookingsForAdmin,
	rejectBooking,
} from "../controllers/expert-appointment.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const expertAppointmentRouter = Router();

expertAppointmentRouter.use(
	["/sports-scientist", "/admin/sports-scientist"],
	authenticateToken,
);

// Admin / Frontdesk endpoints
expertAppointmentRouter.get(
	"/sports-scientist/bookings",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	getAllBookingsForAdmin,
);

expertAppointmentRouter.get(
	"/admin/sports-scientist/bookings",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	getAllBookingsForAdmin,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/accept",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/accept",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/accept",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/accept",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/reject",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/reject",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/reject",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/reject",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/complete",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/complete",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/complete",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/complete",
	authorize(["admin", "sports_scientist", "frontdesk"]),
	completeBooking,
);

export default expertAppointmentRouter;
