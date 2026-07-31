import { Router } from "express";
import { generateToken } from "../controllers/zego.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const zegoRouter = Router();

// Apply JWT token authentication for all Zego routes
zegoRouter.use(authenticateToken);

zegoRouter.post("/token", generateToken);

export default zegoRouter;
