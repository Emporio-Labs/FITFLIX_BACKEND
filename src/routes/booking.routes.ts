import { Router } from "express";
import {
	changeBookingStatus,
	createBooking,
	deleteBookingById,
	getAllBookings,
	getBookingById,
	getMyBookings,
	updateBookingById,
} from "../controllers/booking.controller";
import { authenticateBasicCredentials } from "../middleware/basic-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const bookingRouter = Router();

bookingRouter.use(authenticateBasicCredentials);

bookingRouter.post("/", authorize(["admin", "user"]), createBooking);
bookingRouter.get("/", authorize(["admin"]), getAllBookings);
bookingRouter.get("/me", authorize(["user"]), getMyBookings);
bookingRouter.get("/:id", authorize(["admin"]), getBookingById);
bookingRouter.patch("/:id", authorize(["admin", "user"]), updateBookingById);
bookingRouter.delete("/:id", authorize(["admin"]), deleteBookingById);
bookingRouter.patch("/:id/status", authorize(["admin"]), changeBookingStatus);

export default bookingRouter;
