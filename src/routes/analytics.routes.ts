import { Router } from "express";
import {
	getBookingFunnel,
	getMyAnalytics,
	getSignupFunnel,
	ingestProductAnalytics,
} from "../controllers/analytics.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const analyticsRouter = Router();

analyticsRouter.use(authenticateToken);

// Self-only progress screen analytics
analyticsRouter.get("/me", authorize(["user"]), getMyAnalytics);

// Funnel aggregations for club owner & staff
analyticsRouter.get("/funnels/signup", authorize(["admin", "frontdesk"]), getSignupFunnel);
analyticsRouter.get("/funnels/booking", authorize(["admin", "frontdesk"]), getBookingFunnel);

// Product analytics event sink (FX-22.1)
analyticsRouter.post("/events", ingestProductAnalytics);

export default analyticsRouter;
