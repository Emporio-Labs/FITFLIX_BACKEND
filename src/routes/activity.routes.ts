import { Router } from "express";
import {
	getInterestSummary,
	getMyConsent,
	recordActivity,
	updateMyConsent,
} from "../controllers/activity.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

// Nothing here is public: behaviour is always attributed to an account, and
// an unauthenticated write would be an open door to poisoning the summary.
router.use(authenticateToken);

// ── The app writes its own events, and only its own ──
router.post("/", recordActivity);

// ── Withdrawal must be as easy as granting, so it is a plain toggle on the
// user's own record rather than anything routed through support ──
router.get("/consent", getMyConsent);
router.patch("/consent", updateMyConsent);

// ── Staff read someone else's, before calling them ──
router.get("/summary/:userId", authorize(["admin"]), getInterestSummary);

export default router;
