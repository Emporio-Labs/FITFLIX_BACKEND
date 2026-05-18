import { Router } from "express";
import { login, refreshAccessToken, signup } from "../controllers/auth.controller";
import { authRateLimit } from "../middleware/rate-limit.middleware";

const authRouter = Router();

authRouter.post("/signup", authRateLimit, signup);
authRouter.post("/login", authRateLimit, login);
authRouter.post("/refresh", authRateLimit, refreshAccessToken);

export default authRouter;
