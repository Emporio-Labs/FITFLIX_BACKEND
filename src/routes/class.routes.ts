import { Router } from "express";
import { getClassById } from "../controllers/class.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const classRouter = Router();

// Retrieve class details by ID - requires valid bearer token
classRouter.get("/:id", authenticateToken, getClassById);

export default classRouter;
