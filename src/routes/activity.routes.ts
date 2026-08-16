import { Router } from "express";
import {
	getInterestSummary,
	recordActivity,
} from "../controllers/activity.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

// Nothing here is public: behaviour is always attributed to an account, and
// an unauthenticated write would be an open door to poisoning the summary.
router.use(authenticateToken);

// ── The app writes its own events, and only its own ──
router.post("/", recordActivity);

// ── Staff read someone else's, before calling them ──
router.get("/summary/:userId", authorize(["admin"]), getInterestSummary);

export default router;
