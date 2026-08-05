import { Router } from "express";
import {
	cancelBookingHandler,
	changeBookingStatus,
	createBooking,
	deleteBookingById,
	getAllBookings,
	getBookingById,
	getMyBookings,
	recordAttendance,
	updateBookingById,
} from "../controllers/booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const bookingRouter = Router();

bookingRouter.use(authenticateToken);

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
