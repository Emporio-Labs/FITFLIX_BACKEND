import { Router } from "express";
import { getMyAnalytics } from "../controllers/analytics.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const analyticsRouter = Router();

analyticsRouter.use(authenticateToken);
analyticsRouter.get("/me", authorize(["user"]), getMyAnalytics);

export default analyticsRouter;
