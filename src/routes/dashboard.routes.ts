import { Router } from "express";
import {
	getBranchBoardMetricsHandler,
	getDashboardMetrics,
} from "../controllers/dashboard.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const dashboardRouter = Router();

dashboardRouter.use(authenticateToken);
dashboardRouter.get(
	"/metrics",
	authorize(["admin", "frontdesk", "manager"]),
	getDashboardMetrics,
);

// FX-43.1 & FX-43.4: Multi-Branch Operations Board
dashboardRouter.get(
	"/branch-board",
	authorize(["admin", "frontdesk", "manager"]),
	getBranchBoardMetricsHandler,
);

export default dashboardRouter;
