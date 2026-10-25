import { Router } from "express";
import {
	createAdmin,
	deleteAdminById,
	getAdminById,
	getAllAdmins,
	updateAdminById,
} from "../controllers/admin.controller";
import {
	getDeletionRequests,
	updateDeletionRequestStatus,
} from "../controllers/delete-account.controller";
import { listLoginEvents } from "../controllers/login-event.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const adminRouter = Router();

adminRouter.use(authenticateToken);
adminRouter.post("/", authorize(["admin"]), createAdmin);
adminRouter.get("/", authorize(["admin"]), getAllAdmins);

// Admin Deletion Request Management
adminRouter.get("/deletion-requests", authorize(["admin"]), getDeletionRequests);
adminRouter.patch("/deletion-requests/:id", authorize(["admin"]), updateDeletionRequestStatus);

// Front desk login activity report. Must stay above "/:id".
adminRouter.get("/login-events", authorize(["admin"]), listLoginEvents);

adminRouter.get("/:id", authorize(["admin"]), getAdminById);
adminRouter.patch("/:id", authorize(["admin"]), updateAdminById);
adminRouter.delete("/:id", authorize(["admin"]), deleteAdminById);

export default adminRouter;
