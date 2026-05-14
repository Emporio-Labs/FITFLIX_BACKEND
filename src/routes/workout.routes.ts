import { Router } from "express";
import {
	addExerciseToSession,
	createSession,
	deleteSession,
	deleteSet,
	deleteWorkoutExercise,
	getMyHistory,
	getMyStats,
	getSessionById,
	getTodaySession,
	listMySessions,
	logSet,
	reorderExercises,
	updateSession,
	updateSet,
	updateWorkoutExercise,
} from "../controllers/workout.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const workoutRouter = Router();

workoutRouter.use(authenticateToken);

// Session routes — static paths before parameterized
workoutRouter.get("/today", authorize(["user"]), getTodaySession);
workoutRouter.get("/me", authorize(["user"]), listMySessions);
workoutRouter.get("/me/stats", authorize(["user"]), getMyStats);
workoutRouter.get("/me/history", authorize(["user"]), getMyHistory);
workoutRouter.post("/", authorize(["user"]), createSession);
workoutRouter.get("/:id", authorize(["user"]), getSessionById);
workoutRouter.patch("/:id", authorize(["user"]), updateSession);
workoutRouter.delete("/:id", authorize(["user"]), deleteSession);

// Exercise-in-session routes — /reorder before /:id
workoutRouter.post(
	"/:sessionId/exercises",
	authorize(["user"]),
	addExerciseToSession,
);
workoutRouter.patch(
	"/:sessionId/exercises/reorder",
	authorize(["user"]),
	reorderExercises,
);
workoutRouter.patch(
	"/:sessionId/exercises/:id",
	authorize(["user"]),
	updateWorkoutExercise,
);
workoutRouter.delete(
	"/:sessionId/exercises/:id",
	authorize(["user"]),
	deleteWorkoutExercise,
);

// Set logging routes
workoutRouter.post(
	"/:sessionId/exercises/:exerciseId/sets",
	authorize(["user"]),
	logSet,
);
workoutRouter.patch(
	"/:sessionId/exercises/:exerciseId/sets/:setId",
	authorize(["user"]),
	updateSet,
);
workoutRouter.delete(
	"/:sessionId/exercises/:exerciseId/sets/:setId",
	authorize(["user"]),
	deleteSet,
);

export default workoutRouter;
