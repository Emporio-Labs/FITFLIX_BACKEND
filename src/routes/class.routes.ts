import { Router } from "express";
import {
	createClass,
	getActiveClassesForMembers,
	getAllClassesForAdmin,
	getClassById,
	softDeleteClassById,
	updateClassById,
} from "../controllers/class.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const classRouter = Router();

// Apply JWT token authentication for all routes
classRouter.use(authenticateToken);

// Admin endpoints
classRouter.post("/admin/classes", authorize(["admin"]), createClass);
classRouter.get("/admin/classes", authorize(["admin"]), getAllClassesForAdmin);
classRouter.put("/admin/classes/:id", authorize(["admin"]), updateClassById);
classRouter.delete(
	"/admin/classes/:id",
	authorize(["admin"]),
	softDeleteClassById,
);

// Member endpoints
classRouter.get(
	"/classes",
	authorize(["admin", "trainer", "user"]),
	getActiveClassesForMembers,
);
classRouter.get(
	"/classes/:id",
	authorize(["admin", "trainer", "user"]),
	getClassById,
);

export default classRouter;
