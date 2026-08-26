import { Router } from "express";
import {
	acceptBooking,
	bookNutritionist,
	cancelMyBooking,
	completeBooking,
	getAllBookingsForAdmin,
	getMemberBooking,
	getMyBookings,
	rejectBooking,
	rescheduleMyBooking,
	switchToOnline,
} from "../controllers/nutritionist-booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const nutritionistBookingRouter = Router();

nutritionistBookingRouter.use(
	["/onboarding/nutritionist", "/nutritionist", "/admin/nutrition"],
	authenticateToken,
);

// Member endpoints
nutritionistBookingRouter.post(
	"/onboarding/nutritionist/book",
	authorize(["user"]),
	bookNutritionist,
);

nutritionistBookingRouter.post(
	"/nutritionist/book",
	authorize(["user"]),
	bookNutritionist,
);

nutritionistBookingRouter.get(
	"/nutritionist/my-booking",
	authorize(["user"]),
	getMemberBooking,
);

nutritionistBookingRouter.get(
	"/nutritionist/my-bookings",
	authorize(["user"]),
	getMyBookings,
);

nutritionistBookingRouter.patch(
	"/nutritionist/my-booking/switch-to-online",
	authorize(["user"]),
	switchToOnline,
);

nutritionistBookingRouter.patch(
	"/nutritionist/my-booking/reschedule",
	authorize(["user"]),
	rescheduleMyBooking,
);

nutritionistBookingRouter.post(
	"/nutritionist/my-booking/reschedule",
	authorize(["user"]),
	rescheduleMyBooking,
);

nutritionistBookingRouter.post(
	"/onboarding/nutritionist/reschedule",
	authorize(["user"]),
	rescheduleMyBooking,
);

nutritionistBookingRouter.patch(
	"/onboarding/nutritionist/reschedule",
	authorize(["user"]),
	rescheduleMyBooking,
);

nutritionistBookingRouter.post(
	"/nutritionist/my-booking/switch-to-online",
	authorize(["user"]),
	switchToOnline,
);

nutritionistBookingRouter.patch(
	"/nutritionist/my-booking/cancel",
	authorize(["user"]),
	cancelMyBooking,
);

nutritionistBookingRouter.post(
	"/nutritionist/my-booking/cancel",
	authorize(["user"]),
	cancelMyBooking,
);

// Admin endpoints
nutritionistBookingRouter.get(
	"/nutritionist/bookings",
	authorize(["admin", "nutritionist", "frontdesk"]),
	getAllBookingsForAdmin,
);

nutritionistBookingRouter.patch(
	"/admin/nutrition/bookings/:id/accept",
	authorize(["admin", "nutritionist", "frontdesk"]),
	acceptBooking,
);

nutritionistBookingRouter.post(
	"/admin/nutrition/bookings/:id/accept",
	authorize(["admin", "nutritionist", "frontdesk"]),
	acceptBooking,
);

nutritionistBookingRouter.patch(
	"/nutritionist/bookings/:id/accept",
	authorize(["admin", "nutritionist", "frontdesk"]),
	acceptBooking,
);

nutritionistBookingRouter.patch(
	"/nutritionist/bookings/:id/reject",
	authorize(["admin", "nutritionist", "frontdesk"]),
	rejectBooking,
);

nutritionistBookingRouter.patch(
	"/nutritionist/bookings/:id/complete",
	authorize(["admin", "nutritionist", "frontdesk"]),
	completeBooking,
);

export default nutritionistBookingRouter;
