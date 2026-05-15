import { Router } from "express";
import {
	assignUsers,
	createPlan,
	deletePlan,
	getPlan,
	listPlans,
	updatePlan,
} from "../controllers/workout-plan.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const workoutPlanRouter = Router();

workoutPlanRouter.use(authenticateToken);

workoutPlanRouter.get("/", authorize(["admin", "trainer"]), listPlans);
workoutPlanRouter.post("/", authorize(["admin", "trainer"]), createPlan);
workoutPlanRouter.get("/:id", authorize(["admin", "trainer"]), getPlan);
workoutPlanRouter.patch("/:id", authorize(["admin", "trainer"]), updatePlan);
workoutPlanRouter.delete("/:id", authorize(["admin", "trainer"]), deletePlan);
workoutPlanRouter.post(
	"/:id/assign",
	authorize(["admin", "trainer"]),
	assignUsers,
);

export default workoutPlanRouter;
