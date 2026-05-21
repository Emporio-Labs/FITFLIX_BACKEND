import { Router } from "express";
import {
	createUser,
	deleteUserById,
	getAllUsers,
	getMyUserHpodMetrics,
	getMyUser,
	getMyUserReportPdf,
	getMyUserReports,
	getUserById,
	getOnboardingProfile,
	onboardUser,
	updateMyPassword,
	updateUserById,
} from "../controllers/user.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const userRouter = Router();

userRouter.use(authenticateToken);
userRouter.post("/", authorize(["admin"]), createUser);
userRouter.get("/", authorize(["admin", "doctor"]), getAllUsers);
userRouter.get("/me", authorize(["user"]), getMyUser);
userRouter.get("/me/reports", authorize(["user"]), getMyUserReports);
userRouter.get("/me/hpod-metrics", authorize(["user"]), getMyUserHpodMetrics);
userRouter.get("/me/reports/:id/pdf", authorize(["user"]), getMyUserReportPdf);
userRouter.patch("/me/password", authorize(["user"]), updateMyPassword);
userRouter.get("/:id", authorize(["admin", "doctor"]), getUserById);
userRouter.get("/:id/onboarding-profile", authorize(["admin", "doctor"]), getOnboardingProfile);
userRouter.patch("/:id/onboard", authorize(["admin", "user"]), onboardUser);
userRouter.patch("/:id", authorize(["admin", "user"]), updateUserById);
userRouter.delete("/:id", authorize(["admin"]), deleteUserById);

export default userRouter;
