import { Router } from "express";
import {
	assignPlan,
	completePlanDay,
	getAssignedWorkoutForDay,
	getAssignmentSchedule,
	getMyAssignment,
	getTodayAssignedWorkout,
	updateMyDayExercises,
} from "../controllers/workout-assignment.controller";
import {
	assignUsers,
	createPlan,
	deletePlan,
	duplicatePlan,
	getPlan,
	listPlans,
	updatePlan,
} from "../controllers/workout-plan.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const workoutPlanRouter = Router();

workoutPlanRouter.use(authenticateToken);

// ── Assignment routes (must come before /:id to avoid collision) ──────────────
workoutPlanRouter.get(
	"/assignments/mine",
	authorize(["user"]),
	getMyAssignment,
);
workoutPlanRouter.get(
	"/assignments/mine/schedule",
	authorize(["user"]),
	getAssignmentSchedule,
);
workoutPlanRouter.get(
	"/assignments/mine/today",
	authorize(["user"]),
	getTodayAssignedWorkout,
);
workoutPlanRouter.get(
	"/assignments/mine/days/:dayNumber",
	authorize(["user"]),
	getAssignedWorkoutForDay,
);
workoutPlanRouter.post(
	"/assignments/mine/complete-day",
	authorize(["user"]),
	completePlanDay,
);
workoutPlanRouter.patch(
	"/assignments/mine/days/:dayNumber",
	authorize(["user"]),
	updateMyDayExercises,
);

// ── Plan CRUD ─────────────────────────────────────────────────────────────────
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
workoutPlanRouter.post(
	"/:id/duplicate",
	authorize(["admin", "trainer"]),
	duplicatePlan,
);
workoutPlanRouter.post(
	"/:planId/assign-to-me",
	authorize(["user", "trainer", "admin"]),
	assignPlan,
);

export default workoutPlanRouter;
