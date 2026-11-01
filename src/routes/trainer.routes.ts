import { Router, type RequestHandler } from "express";
import multer from "multer";
import {
	createTrainer,
	deleteTrainerById,
	getAllTrainers,
	getMyMemberById,
	getMyMembers,
	getMyTrainerProfile,
	getPublicTrainerById,
	getPublicTrainers,
	getTrainerById,
	updateMyTrainerProfile,
	updateTrainerById,
	uploadTrainerImage,
} from "../controllers/trainer.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware, uploadRateLimiter } from "../middleware/upload.middleware";
import { subjectIsMember } from "../middleware/workoutSubject.middleware";
import { buildWorkoutRouter } from "./workout.routes";

const uploadImageMulter: RequestHandler = (req, res, next) => {
	uploadMiddleware.single("image")(req, res, (err: unknown) => {
		if (err instanceof multer.MulterError) {
			res.status(400).json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		if (err) {
			res.status(400).json({ error: (err as Error).message || "Upload failed", code: "BAD_REQUEST" });
			return;
		}
		next();
	});
};

const trainerRouter = Router();

trainerRouter.get("/public", getPublicTrainers);
trainerRouter.get("/public/:id", getPublicTrainerById);

trainerRouter.use(authenticateToken);
trainerRouter.post("/", authorize(["admin"]), createTrainer);
trainerRouter.get("/", authorize(["admin"]), getAllTrainers);

// ── Trainer Profile & Avatar Upload ─────────────────────────────────────────
// Mounted before "/:id" so "upload-image" and "me" are not matched as ObjectId.
trainerRouter.post(
	"/upload-image",
	authorize(["admin", "trainer"]),
	uploadRateLimiter,
	uploadImageMulter,
	uploadTrainerImage,
);

trainerRouter.get(
	"/me",
	authorize(["trainer"]),
	getMyTrainerProfile,
);

trainerRouter.patch(
	"/me",
	authorize(["trainer"]),
	updateMyTrainerProfile,
);

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
	authorize(["admin", "trainer"]),
	updateTrainerById,
);
trainerRouter.delete("/:id", authorize(["admin"]), deleteTrainerById);

export default trainerRouter;
