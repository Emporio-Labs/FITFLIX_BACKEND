import { Router } from "express";
import {
	getBranchFunnels,
	getMyAnalytics,
} from "../controllers/analytics.controller";
import { requireAnalyticsKey } from "../middleware/analytics-key.middleware";
import { staffGuard } from "../middleware/branch-scope.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const analyticsRouter = Router();

analyticsRouter.use(authenticateToken);
// FX-27 — re-derive the caller's branch scope from the DB. A no-op for members
// (the /me route) and for GET reads while STAFF_RBAC_ENFORCE is off; when on, it
// confines branch-scoped staff to their own branches' funnels (FX-27.2).
analyticsRouter.use(...staffGuard);

// Member Progress screen — self-only.
analyticsRouter.get("/me", authorize(["user"]), getMyAnalytics);

// FX-27 — branch sign-up + booking funnels for the Frontdesk Analytics page.
// Admin/front-desk only (FX-27.4), branch-scoped (FX-27.2), and gated by the
// service key the Frontdesk server proxy sends (FX-27.3).
analyticsRouter.get(
	"/funnels",
	authorize(["admin", "frontdesk"]),
	requireAnalyticsKey,
	getBranchFunnels,
);

export default analyticsRouter;
