import { Router } from "express";
import { setPassword, verifyInvite } from "../controllers/admin.controller";
import {
	login,
	logout,
	refreshAccessToken,
	signup,
} from "../controllers/auth.controller";
import { registerPhone, verifyPhone } from "../controllers/phone-auth.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authRateLimit } from "../middleware/rate-limit.middleware";

const authRouter = Router();

authRouter.post("/signup", authRateLimit, signup);
authRouter.post("/login", authRateLimit, login);
authRouter.post("/refresh", authRateLimit, refreshAccessToken);
authRouter.post("/logout", authRateLimit, authenticateToken, logout);

// FX-32.4 — public set-password flow for an invited/reset staff account. No auth
// guard: the person is setting their first password and is not signed in yet.
authRouter.get("/invite/:token", authRateLimit, verifyInvite);
authRouter.post("/set-password", authRateLimit, setPassword);

// Phone + OTP auth (user app) — Firebase ID token in, backend JWT out.
authRouter.post("/phone/verify", authRateLimit, verifyPhone);
authRouter.post("/phone/register", authRateLimit, registerPhone);

export default authRouter;
