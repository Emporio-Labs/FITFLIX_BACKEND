import { Router } from "express";
import { getDashboardMetrics } from "../controllers/dashboard.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const dashboardRouter = Router();

dashboardRouter.use(authenticateToken);
dashboardRouter.get(
	"/metrics",
	authorize(["admin", "frontdesk"]),
	getDashboardMetrics,
);

export default dashboardRouter;
