import { Router } from "express";
import {
	createMembership,
	deleteMembershipById,
	getAllMemberships,
	getMembershipById,
	getMyMemberships,
	updateMembershipById,
} from "../controllers/membership.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const membershipRouter = Router();

membershipRouter.use(authenticateToken);

membershipRouter.post("/", authorize(["admin"]), createMembership);
membershipRouter.get("/", authorize(["admin", "frontdesk"]), getAllMemberships);
membershipRouter.get("/me", authorize(["user"]), getMyMemberships);
membershipRouter.get(
	"/:id",
	authorize(["admin", "frontdesk"]),
	getMembershipById,
);
membershipRouter.patch("/:id", authorize(["admin"]), updateMembershipById);
membershipRouter.delete("/:id", authorize(["admin"]), deleteMembershipById);

export default membershipRouter;
