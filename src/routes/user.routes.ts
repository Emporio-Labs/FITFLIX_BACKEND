import { Router } from "express";
import {
	createUser,
	deleteUserById,
	getAllUsers,
	getMyMedicalReports,
	getMyUser,
	getMyUserHpodMetrics,
	getMyUserReportPdf,
	getMyUserReports,
	getOnboardingProfile,
	getReportSignedUrl,
	getUserById,
	onboardUser,
	updateMyPassword,
	updateUserById,
} from "../controllers/user.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const userRouter = Router();

userRouter.use(authenticateToken);
userRouter.post("/", authorize(["admin"]), createUser);
userRouter.get("/", authorize(["admin", "doctor", "nutritionist"]), getAllUsers);
userRouter.get("/me", authorize(["user"]), getMyUser);
userRouter.get("/me/reports", authorize(["user"]), getMyUserReports);
userRouter.get("/me/medical-reports", authorize(["user"]), getMyMedicalReports);
userRouter.get("/me/hpod-metrics", authorize(["user"]), getMyUserHpodMetrics);
userRouter.get("/me/reports/:id/pdf", authorize(["user"]), getMyUserReportPdf);
userRouter.patch("/me/password", authorize(["user"]), updateMyPassword);
userRouter.get("/:id", authorize(["admin", "doctor", "nutritionist"]), getUserById);
userRouter.get(
	"/:id/onboarding-profile",
	authorize(["admin", "doctor", "nutritionist"]),
	getOnboardingProfile,
);
userRouter.get(
	"/:id/reports/:reportId/url",
	authorize(["admin", "doctor", "nutritionist"]),
	getReportSignedUrl,
);
userRouter.patch("/:id/onboard", authorize(["admin", "user"]), onboardUser);
userRouter.patch("/:id", authorize(["admin", "user"]), updateUserById);
userRouter.delete("/:id", authorize(["admin"]), deleteUserById);

export default userRouter;
