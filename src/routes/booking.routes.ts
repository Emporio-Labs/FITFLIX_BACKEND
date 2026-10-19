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
import { staffGuard } from "../middleware/branch-scope.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const bookingRouter = Router();

bookingRouter.use(authenticateToken);
bookingRouter.use(...staffGuard);

// FX-12 Class Waitlist Routes (must be registered before /:id)
bookingRouter.post("/waitlist", authorize(["admin", "user"]), joinWaitlistHandler);
bookingRouter.post("/waitlist/join", authorize(["admin", "user"]), joinWaitlistHandler);
bookingRouter.get("/waitlist/me", authorize(["admin", "user"]), getMyWaitlistHandler);
bookingRouter.get("/waitlist/admin", authorize(["admin"]), getAdminWaitlistHandler);
bookingRouter.get("/waitlist", authorize(["admin"]), getAdminWaitlistHandler);
bookingRouter.delete("/waitlist/:sessionId", authorize(["admin", "user"]), leaveWaitlistHandler);

bookingRouter.post("/", authorize(["admin", "user"]), createBooking);
bookingRouter.get("/", authorize(["admin"]), getAllBookings);
bookingRouter.get("/me", authorize(["user"]), getMyBookings);
bookingRouter.get("/:id", authorize(["admin", "user"]), getBookingById);
bookingRouter.post("/:id/cancel", authorize(["admin", "user"]), cancelBookingHandler);
bookingRouter.post("/:id/attendance", authorize(["admin", "user"]), recordAttendance);
bookingRouter.patch("/:id", authorize(["admin", "user"]), updateBookingById);
bookingRouter.delete("/:id", authorize(["admin", "user"]), deleteBookingById);
bookingRouter.patch("/:id/status", authorize(["admin", "user"]), changeBookingStatus);

export default bookingRouter;
