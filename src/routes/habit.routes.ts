import { Router } from "express";
import {
	createHabitHandler,
	getHabitCatalogHandler,
	getMemberHabitsForStaffHandler,
	getMyHabitsHandler,
	getTodayHabitsHandler,
	toggleHabitHandler,
	updateHabitHandler,
} from "../controllers/habit.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const habitRouter = Router();

habitRouter.use(authenticateToken);

habitRouter.get("/catalog", getHabitCatalogHandler);
habitRouter.get("/me/today", getTodayHabitsHandler);
habitRouter.post("/me/toggle", toggleHabitHandler);
habitRouter.get("/me", getMyHabitsHandler);
habitRouter.post("/me", createHabitHandler);
habitRouter.patch("/me/:id", updateHabitHandler);
habitRouter.get("/user/:userId", getMemberHabitsForStaffHandler);

export default habitRouter;
