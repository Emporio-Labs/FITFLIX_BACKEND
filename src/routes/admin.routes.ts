import { Router } from "express";
import {
	createAdmin,
	deleteAdminById,
	getAdminById,
	getAllAdmins,
	updateAdminById,
} from "../controllers/admin.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const adminRouter = Router();

adminRouter.use(authenticateToken);
adminRouter.post("/", authorize(["admin"]), createAdmin);
adminRouter.get("/", authorize(["admin"]), getAllAdmins);
adminRouter.get("/:id", authorize(["admin"]), getAdminById);
adminRouter.patch("/:id", authorize(["admin"]), updateAdminById);
adminRouter.delete("/:id", authorize(["admin"]), deleteAdminById);

export default adminRouter;
