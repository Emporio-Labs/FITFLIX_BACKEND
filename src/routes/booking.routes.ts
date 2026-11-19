import { Router } from "express";
import {
	cancelBookingHandler,
	changeBookingStatus,
	createBooking,
	deleteBookingById,
	getAdminWaitlistHandler,
	getAllBookings,
	getBookingById,
	getMyBookings,
	getMyWaitlistHandler,
	joinWaitlistHandler,
	leaveWaitlistHandler,
	recordAttendance,
	updateBookingById,
} from "../controllers/booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const bookingRouter = Router();

bookingRouter.use(authenticateToken);

// FX-12 Class Waitlist Routes (must be registered before /:id)
bookingRouter.post("/waitlist", authorize(["admin", "frontdesk", "manager", "user"]), joinWaitlistHandler);
bookingRouter.post("/waitlist/join", authorize(["admin", "frontdesk", "manager", "user"]), joinWaitlistHandler);
bookingRouter.get("/waitlist/me", authorize(["admin", "frontdesk", "manager", "user"]), getMyWaitlistHandler);
bookingRouter.get("/waitlist/admin", authorize(["admin", "frontdesk", "manager"]), getAdminWaitlistHandler);
bookingRouter.get("/waitlist", authorize(["admin", "frontdesk", "manager"]), getAdminWaitlistHandler);
bookingRouter.delete("/waitlist/:sessionId", authorize(["admin", "frontdesk", "manager", "user"]), leaveWaitlistHandler);

bookingRouter.post("/", authorize(["admin", "frontdesk", "manager", "user"]), createBooking);
bookingRouter.get("/", authorize(["admin", "frontdesk", "manager"]), getAllBookings);
bookingRouter.get("/me", authorize(["user"]), getMyBookings);
bookingRouter.get("/:id", authorize(["admin", "frontdesk", "manager", "user"]), getBookingById);
bookingRouter.post("/:id/cancel", authorize(["admin", "frontdesk", "manager", "user"]), cancelBookingHandler);
bookingRouter.post("/:id/attendance", authorize(["admin", "frontdesk", "manager", "user"]), recordAttendance);
bookingRouter.patch("/:id", authorize(["admin", "frontdesk", "manager", "user"]), updateBookingById);
bookingRouter.delete("/:id", authorize(["admin"]), deleteBookingById);
bookingRouter.patch("/:id/status", authorize(["admin", "frontdesk", "manager", "user"]), changeBookingStatus);

export default bookingRouter;
