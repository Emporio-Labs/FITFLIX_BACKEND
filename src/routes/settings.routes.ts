import { Router } from "express";
import {
	getConferenceSettings,
	updateConferenceSettings,
} from "../controllers/settings.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";

const settingsRouter = Router();

// Apply JWT authentication to all admin settings routes
settingsRouter.use(authenticateToken);

settingsRouter.get("/rooms", getConferenceSettings);
settingsRouter.put("/rooms", updateConferenceSettings);

export default settingsRouter;
