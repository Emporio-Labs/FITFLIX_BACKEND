import { Router } from "express";
import {
	createTrainer,
	deleteTrainerById,
	getAllTrainers,
	getMyMemberById,
	getMyMembers,
	getPublicTrainerById,
	getPublicTrainers,
	getTrainerById,
	updateTrainerById,
} from "../controllers/trainer.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { subjectIsMember } from "../middleware/workoutSubject.middleware";
import { buildWorkoutRouter } from "./workout.routes";

const trainerRouter = Router();

trainerRouter.get("/public", getPublicTrainers);
trainerRouter.get("/public/:id", getPublicTrainerById);

trainerRouter.use(authenticateToken);
trainerRouter.post("/", authorize(["admin"]), createTrainer);
trainerRouter.get("/", authorize(["admin"]), getAllTrainers);

// ── Roster: members assigned to the authenticated trainer ─────────────────
// Mounted before "/:id" so "me" doesn't get swallowed as a trainer id.
trainerRouter.get(
	"/me/members",
	authorize(["trainer", "admin"]),
	getMyMembers,
);
trainerRouter.get(
	"/me/members/:userId",
	authorize(["trainer", "admin"]),
	getMyMemberById,
);

// Trainer acting on a member's workouts
trainerRouter.use(
	"/me/members/:userId/workouts",
	buildWorkoutRouter(["trainer", "admin"], subjectIsMember),
);

trainerRouter.get("/:id", authorize(["admin", "trainer", "doctor"]), getTrainerById);
trainerRouter.patch(
	"/:id",
	authorize(["admin", "trainer", "doctor"]),
	updateTrainerById,
);
trainerRouter.delete("/:id", authorize(["admin"]), deleteTrainerById);

export default trainerRouter;
