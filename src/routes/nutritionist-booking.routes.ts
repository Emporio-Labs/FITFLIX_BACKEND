import { Router } from "express";
import {
	acceptBooking,
	bookNutritionist,
	getMemberBooking,
	switchToOnline,
} from "../controllers/nutritionist-booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const nutritionistBookingRouter = Router();

nutritionistBookingRouter.use(authenticateToken);

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

nutritionistBookingRouter.patch(
	"/nutritionist/my-booking/switch-to-online",
	authorize(["user"]),
	switchToOnline,
);

nutritionistBookingRouter.post(
	"/nutritionist/my-booking/switch-to-online",
	authorize(["user"]),
	switchToOnline,
);

// Admin endpoints
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

export default nutritionistBookingRouter;
