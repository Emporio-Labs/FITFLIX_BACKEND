import { Router } from "express";
import { bookNutritionist } from "../controllers/nutritionist-booking.controller";
import {
	deleteNutritionistAppointment,
	getStatus,
	submitAppointment,
	submitComplete,
	submitConsent,
	submitHealthGoals,
	submitHealthMarkers,
	submitNutritionistAppointment,
	submitReport,
	submitSportsScientistAppointment,
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
onboardingRouter.post(
	"/sports-scientist",
	authorize(["user"]),
	submitSportsScientistAppointment,
);
onboardingRouter.post(
	"/nutritionist/book",
	authorize(["user"]),
	bookNutritionist,
);
onboardingRouter.post(
	"/nutritionist",
	authorize(["user"]),
	submitNutritionistAppointment,
);
onboardingRouter.post("/appointments", authorize(["user"]), submitAppointment);
onboardingRouter.delete(
	"/appointments/nutritionist/:userId",
	authorize(["admin"]),
	deleteNutritionistAppointment,
);
onboardingRouter.post("/complete", authorize(["user"]), submitComplete);

export default onboardingRouter;
