import { Router } from "express";
import {
	createGoalHandler,
	getMemberGoalsForStaffHandler,
	getMyGoalsHandler,
	updateGoalHandler,
} from "../controllers/goal.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const goalRouter = Router();

goalRouter.use(authenticateToken);

goalRouter.get("/me", getMyGoalsHandler);
goalRouter.post("/me", createGoalHandler);
goalRouter.patch("/me/:id", updateGoalHandler);
goalRouter.get("/user/:userId", getMemberGoalsForStaffHandler);

export default goalRouter;
