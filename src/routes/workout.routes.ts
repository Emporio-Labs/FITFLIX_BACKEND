import { Router, type RequestHandler } from "express";
import {
	addExerciseToSession,
	createSession,
	deleteSession,
	deleteSet,
	deleteWorkoutExercise,
	getActiveSession,
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
import { subjectIsSelf } from "../middleware/workoutSubject.middleware";
import type { AppUserRole } from "../types/auth";

/**
 * Builds the workout-session routes against an arbitrary "subject" — the
 * member's own data (self-service) or a roster member's data (trainer PT
 * logging). Both mounts share every handler unchanged; only the role guard
 * and the middleware that resolves `req.subjectUserId` differ.
 */
export const buildWorkoutRouter = (
	roles: AppUserRole[],
	subjectResolver: RequestHandler,
): Router => {
	const router = Router({ mergeParams: true });
	const guard = authorize(roles);

	// Static paths before parameterized
	router.get("/active", guard, subjectResolver, getActiveSession);
	router.get("/today", guard, subjectResolver, getTodaySession);
	router.get("/me", guard, subjectResolver, listMySessions);
	router.get("/me/stats", guard, subjectResolver, getMyStats);
	router.get("/me/history", guard, subjectResolver, getMyHistory);
	router.post("/", guard, subjectResolver, createSession);
	router.get("/:id", guard, subjectResolver, getSessionById);
	router.patch("/:id", guard, subjectResolver, updateSession);
	router.delete("/:id", guard, subjectResolver, deleteSession);

	// Exercise-in-session routes — /reorder before /:id
	router.post(
		"/:sessionId/exercises",
		guard,
		subjectResolver,
		addExerciseToSession,
	);
	router.patch(
		"/:sessionId/exercises/reorder",
		guard,
		subjectResolver,
		reorderExercises,
	);
	router.patch(
		"/:sessionId/exercises/:id",
		guard,
		subjectResolver,
		updateWorkoutExercise,
	);
	router.delete(
		"/:sessionId/exercises/:id",
		guard,
		subjectResolver,
		deleteWorkoutExercise,
	);

	// Set logging routes
	router.post(
		"/:sessionId/exercises/:exerciseId/sets",
		guard,
		subjectResolver,
		logSet,
	);
	router.patch(
		"/:sessionId/exercises/:exerciseId/sets/:setId",
		guard,
		subjectResolver,
		updateSet,
	);
	router.delete(
		"/:sessionId/exercises/:exerciseId/sets/:setId",
		guard,
		subjectResolver,
		deleteSet,
	);

	return router;
};

const workoutRouter = Router();
workoutRouter.use(authenticateToken);
workoutRouter.use(buildWorkoutRouter(["user"], subjectIsSelf));

export default workoutRouter;
