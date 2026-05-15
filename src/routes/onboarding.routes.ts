import { Router } from "express";
import {
	getStatus,
	submitAppointment,
	submitComplete,
	submitConsent,
	submitHealthGoals,
	submitHealthMarkers,
	submitReport,
} from "../controllers/onboarding.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const onboardingRouter = Router();

onboardingRouter.use(authenticateToken);
onboardingRouter.get("/status", authorize(["user"]), getStatus);
onboardingRouter.post("/health-markers", authorize(["user"]), submitHealthMarkers);
onboardingRouter.post("/health-goals", authorize(["user"]), submitHealthGoals);
onboardingRouter.post("/consent", authorize(["user"]), submitConsent);
onboardingRouter.post("/reports", authorize(["user"]), submitReport);
onboardingRouter.post("/appointments", authorize(["user"]), submitAppointment);
onboardingRouter.post("/complete", authorize(["user"]), submitComplete);

export default onboardingRouter;
