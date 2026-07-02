import { Router } from "express";
import {
	createGroupClass,
	deleteGroupClassById,
	getAllGroupClasses,
	getGroupClassById,
	updateGroupClassById,
} from "../controllers/group-class.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const groupClassRouter = Router();

groupClassRouter.use(authenticateToken);

groupClassRouter.get(
	"/",
	authorize(["admin", "doctor", "trainer", "user"]),
	getAllGroupClasses,
);
groupClassRouter.get(
	"/:id",
	authorize(["admin", "doctor", "trainer", "user"]),
	getGroupClassById,
);
groupClassRouter.post("/", authorize(["admin"]), createGroupClass);
groupClassRouter.patch("/:id", authorize(["admin"]), updateGroupClassById);
groupClassRouter.delete("/:id", authorize(["admin"]), deleteGroupClassById);

export default groupClassRouter;
