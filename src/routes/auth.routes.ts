import { Router } from "express";
import { login, logout, refreshAccessToken, signup } from "../controllers/auth.controller";
import { registerPhone, verifyPhone } from "../controllers/phone-auth.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authRateLimit } from "../middleware/rate-limit.middleware";

const authRouter = Router();

authRouter.post("/signup", authRateLimit, signup);
authRouter.post("/login", authRateLimit, login);
authRouter.post("/refresh", authRateLimit, refreshAccessToken);
authRouter.post("/logout", authRateLimit, authenticateToken, logout);

// Phone + OTP auth (user app) — Firebase ID token in, backend JWT out.
authRouter.post("/phone/verify", authRateLimit, verifyPhone);
authRouter.post("/phone/register", authRateLimit, registerPhone);

export default authRouter;
