import { Router } from "express";
import {
	acceptNutritionistBooking,
	getMyNutritionistBooking,
	listNutritionistBookings,
	rejectNutritionistBooking,
} from "../controllers/nutritionist-booking.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const nutritionistRouter = Router();

nutritionistRouter.use(authenticateToken);

nutritionistRouter.get(
	"/my-booking",
	authorize(["user"]),
	getMyNutritionistBooking,
);

nutritionistRouter.get(
	"/bookings",
	authorize(["admin"]),
	listNutritionistBookings,
);

nutritionistRouter.patch(
	"/bookings/:id/accept",
	authorize(["admin"]),
	acceptNutritionistBooking,
);

nutritionistRouter.patch(
	"/bookings/:id/reject",
	authorize(["admin"]),
	rejectNutritionistBooking,
);

export default nutritionistRouter;
