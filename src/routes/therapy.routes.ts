import { Router } from "express";
import {
	createTherapy,
	deleteTherapyById,
	getAllTherapies,
	getPublicTherapies,
	getPublicTherapyById,
	getTherapyById,
	updateTherapyById,
} from "../controllers/therapy.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const therapyRouter = Router();

therapyRouter.get("/public", getPublicTherapies);
therapyRouter.get("/public/:id", getPublicTherapyById);

therapyRouter.use(authenticateToken);
therapyRouter.get(
	"/",
	authorize(["admin", "doctor", "trainer", "user"]),
	getAllTherapies,
);
therapyRouter.get(
	"/:id",
	authorize(["admin", "doctor", "trainer", "user"]),
	getTherapyById,
);
therapyRouter.post("/", authorize(["admin"]), createTherapy);
therapyRouter.patch("/:id", authorize(["admin"]), updateTherapyById);
therapyRouter.delete("/:id", authorize(["admin"]), deleteTherapyById);

export default therapyRouter;
