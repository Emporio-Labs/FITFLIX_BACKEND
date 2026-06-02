import { Router } from "express";
import {
	login,
	logout,
	refreshAccessToken,
	signup,
} from "../controllers/auth.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authRateLimit } from "../middleware/rate-limit.middleware";

const authRouter = Router();

authRouter.post("/signup", authRateLimit, signup);
authRouter.post("/login", authRateLimit, login);
authRouter.post("/refresh", authRateLimit, refreshAccessToken);
authRouter.post("/logout", authRateLimit, authenticateToken, logout);

export default authRouter;
