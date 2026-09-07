import { Router } from "express";
import {
	bookSportsScientist,
	getStatus,
	getStatusByUserId,
	skipAllSteps,
	skipSportsScientist,
	skipStep,
	submitComplete,
	submitConsent,
	submitHealthGoals,
	submitHealthMarkers,
	submitReport,
	updateSharedStep,
} from "../controllers/onboarding.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import {
	uploadMiddleware,
	uploadRateLimiter,
} from "../middleware/upload.middleware";

const onboardingRouter = Router();

onboardingRouter.use(authenticateToken);
onboardingRouter.get("/status", authorize(["user"]), getStatus);
onboardingRouter.get(
	"/status/:userId",
	authorize(["admin", "frontdesk"]),
	getStatusByUserId,
);
onboardingRouter.patch(
	"/steps/:userId/:step",
	authorize(["admin", "frontdesk"]),
	updateSharedStep,
);
onboardingRouter.post(
	"/sports-scientist",
	authorize(["user"]),
	bookSportsScientist,
);
onboardingRouter.post(
	"/sports-scientist/skip",
	authorize(["user"]),
	skipSportsScientist,
);
// Generic skip for any deferrable app-owned step (see SKIPPABLE_STEPS in
// onboarding.service.ts). Superset of the sports-scientist route above.
// The two-segment skip-all path cannot be shadowed by the three-segment
// ":step/skip" one, so declaration order between them does not matter.
onboardingRouter.post("/steps/skip-all", authorize(["user"]), skipAllSteps);
onboardingRouter.post("/steps/:step/skip", authorize(["user"]), skipStep);
onboardingRouter.post(
	"/health-markers",
	authorize(["user"]),
	submitHealthMarkers,
);
onboardingRouter.post("/health-goals", authorize(["user"]), submitHealthGoals);
onboardingRouter.post("/consent", authorize(["user"]), submitConsent);
onboardingRouter.post(
	"/reports",
	authorize(["user"]),
	uploadRateLimiter,
	uploadMiddleware.single("file"),
	submitReport,
);
onboardingRouter.post("/complete", authorize(["user"]), submitComplete);

export default onboardingRouter;
