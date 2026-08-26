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
	authorize(["admin", "frontdesk"]),
	getAllBookingsForAdmin,
);

expertAppointmentRouter.get(
	"/admin/sports-scientist/bookings",
	authorize(["admin", "frontdesk"]),
	getAllBookingsForAdmin,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/accept",
	authorize(["admin", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/accept",
	authorize(["admin", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/accept",
	authorize(["admin", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/accept",
	authorize(["admin", "frontdesk"]),
	acceptBooking,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/reject",
	authorize(["admin", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/reject",
	authorize(["admin", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/reject",
	authorize(["admin", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/reject",
	authorize(["admin", "frontdesk"]),
	rejectBooking,
);

expertAppointmentRouter.patch(
	"/sports-scientist/bookings/:id/complete",
	authorize(["admin", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.post(
	"/sports-scientist/bookings/:id/complete",
	authorize(["admin", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.patch(
	"/admin/sports-scientist/bookings/:id/complete",
	authorize(["admin", "frontdesk"]),
	completeBooking,
);

expertAppointmentRouter.post(
	"/admin/sports-scientist/bookings/:id/complete",
	authorize(["admin", "frontdesk"]),
	completeBooking,
);

export default expertAppointmentRouter;
