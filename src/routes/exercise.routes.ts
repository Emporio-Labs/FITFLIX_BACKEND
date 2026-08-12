import { Router } from "express";
import {
	createExercise,
	deleteExercise,
	getExerciseById,
	listExercises,
	updateExercise,
} from "../controllers/exercise.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const exerciseRouter = Router();

exerciseRouter.use(authenticateToken);

exerciseRouter.get("/", authorize(["admin", "user", "trainer"]), listExercises);
exerciseRouter.get(
	"/:id",
	authorize(["admin", "user", "trainer"]),
	getExerciseById,
);
exerciseRouter.post(
	"/",
	authorize(["admin", "user", "trainer"]),
	createExercise,
);
exerciseRouter.put(
	"/:id",
	authorize(["admin", "user", "trainer"]),
	updateExercise,
);
exerciseRouter.delete(
	"/:id",
	authorize(["admin", "user", "trainer"]),
	deleteExercise,
);

export default exerciseRouter;
