import { Router } from "express";
import {
	listMemberNotifications,
	sendMemberNotification,
} from "../controllers/member-notification.controller";
import { staffGuard } from "../middleware/branch-scope.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

/**
 * FX-20.3 — club-wide member notifications (the staff "Announcements" composer).
 *
 * Staff-only. `staffGuard` enforces FX-17 branch scope when STAFF_RBAC_ENFORCE
 * is on: a branch-scoped staffer naming another branch in the body is rejected
 * (NOT_YOUR_BRANCH), and the controller additionally refuses a company-wide
 * send from a branch-scoped caller.
 */
const router = Router();

router.use(authenticateToken);
router.use(...staffGuard);

router.get("/", authorize(["admin", "frontdesk"]), listMemberNotifications);
router.post("/", authorize(["admin", "frontdesk"]), sendMemberNotification);

export default router;
