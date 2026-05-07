import { Router } from "express";
import {
	createTrainer,
	deleteTrainerById,
	getAllTrainers,
	getTrainerById,
	getPublicTrainerById,
	getPublicTrainers,
	updateTrainerById,
} from "../controllers/trainer.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const trainerRouter = Router();

trainerRouter.get("/public", getPublicTrainers);
trainerRouter.get("/public/:id", getPublicTrainerById);

trainerRouter.use(authenticateToken);
trainerRouter.post("/", authorize(["admin"]), createTrainer);
trainerRouter.get("/", authorize(["admin"]), getAllTrainers);
trainerRouter.get("/:id", authorize(["trainer", "doctor"]), getTrainerById);
trainerRouter.patch(
	"/:id",
	authorize(["trainer", "doctor"]),
	updateTrainerById,
);
trainerRouter.delete("/:id", authorize(["admin"]), deleteTrainerById);

export default trainerRouter;
