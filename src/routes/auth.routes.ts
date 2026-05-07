import { Router } from "express";
import { login, signup } from "../controllers/auth.controller";
import { authRateLimit } from "../middleware/rate-limit.middleware";

const authRouter = Router();

authRouter.post("/signup", authRateLimit, signup);
authRouter.post("/login", authRateLimit, login);

export default authRouter;
