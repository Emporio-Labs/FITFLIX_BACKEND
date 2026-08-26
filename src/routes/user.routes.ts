import { Router } from "express";
import {
	createUser,
	deleteUserById,
	getAllUsers,
	getMyMedicalReports,
	getMyUser,
	getMyUserBcaMetrics,
	getMyUserReports,
	getOnboardingProfile,
	getReportSignedUrl,
	getUserBcaMetrics,
	getUserById,
	onboardUser,
	syncMyBcaMetrics,
	updateAssignedTrainer,
	updateMyPassword,
	updateUserById,
} from "../controllers/user.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const userRouter = Router();

userRouter.use(authenticateToken);
userRouter.post("/", authorize(["admin"]), createUser);
userRouter.get(
	"/",
	authorize(["admin", "doctor", "nutritionist", "trainer"]),
	getAllUsers,
);
userRouter.get("/me", authorize(["user"]), getMyUser);
userRouter.get("/me/reports", authorize(["user"]), getMyUserReports);
userRouter.get("/me/medical-reports", authorize(["user"]), getMyMedicalReports);
userRouter.get("/me/bca-metrics", authorize(["user"]), getMyUserBcaMetrics);
userRouter.post(
	"/me/bca-metrics/sync",
	authorize(["user"]),
	syncMyBcaMetrics,
);
userRouter.patch("/me/password", authorize(["user"]), updateMyPassword);
userRouter.get(
	"/:id",
	authorize(["admin", "doctor", "nutritionist", "user", "trainer"]),
	getUserById,
);
userRouter.get(
	"/:id/onboarding-profile",
	authorize(["admin", "doctor", "nutritionist", "user", "trainer"]),
	getOnboardingProfile,
);
userRouter.get(
	"/:id/reports/:reportId/url",
	authorize(["admin", "doctor", "nutritionist", "trainer"]),
	getReportSignedUrl,
);
userRouter.get(
	"/:id/bca-metrics",
	authorize(["admin", "frontdesk"]),
	getUserBcaMetrics,
);
userRouter.patch("/:id/onboard", authorize(["admin", "user"]), onboardUser);
userRouter.patch(
	"/:id/assigned-trainer",
	authorize(["admin"]),
	updateAssignedTrainer,
);
userRouter.patch("/:id", authorize(["admin", "user"]), updateUserById);
userRouter.delete("/:id", authorize(["admin"]), deleteUserById);

export default userRouter;
