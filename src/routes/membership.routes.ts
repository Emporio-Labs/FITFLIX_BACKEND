import { Router } from "express";
import {
	createMembership,
	deleteMembershipById,
	getAllMemberships,
	getMembershipById,
	getMyMemberships,
	pauseMembershipHandler,
	resumeMembershipHandler,
	updateMembershipById,
} from "../controllers/membership.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const membershipRouter = Router();

membershipRouter.use(authenticateToken);

membershipRouter.post(
	"/",
	authorize(["admin", "frontdesk", "manager"]),
	createMembership,
);
membershipRouter.get(
	"/",
	authorize(["admin", "frontdesk", "manager"]),
	getAllMemberships,
);
membershipRouter.get("/me", authorize(["user"]), getMyMemberships);
membershipRouter.get(
	"/:id",
	authorize(["admin", "frontdesk", "manager"]),
	getMembershipById,
);
// Freeze/resume is a front-desk retention action, not just an admin one.
membershipRouter.post(
	"/:id/pause",
	authorize(["admin", "frontdesk", "manager"]),
	pauseMembershipHandler,
);
membershipRouter.post(
	"/:id/resume",
	authorize(["admin", "frontdesk", "manager"]),
	resumeMembershipHandler,
);

membershipRouter.patch(
	"/:id",
	authorize(["admin", "manager"]),
	updateMembershipById,
);
membershipRouter.delete("/:id", authorize(["admin"]), deleteMembershipById);

export default membershipRouter;
