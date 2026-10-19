import { Router } from "express";
import { getDashboardMetrics } from "../controllers/dashboard.controller";
import { staffGuard } from "../middleware/branch-scope.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const dashboardRouter = Router();

dashboardRouter.use(authenticateToken);
// FX-18.1 — attach the caller's branch scope so the metrics below are confined
// to the branches a scoped staffer works at (no-op for a global admin / when
// enforcement is off). GET-only, so enforceBranchScope inside staffGuard passes.
dashboardRouter.get(
	"/metrics",
	authorize(["admin", "frontdesk"]),
	...staffGuard,
	getDashboardMetrics,
);

export default dashboardRouter;
