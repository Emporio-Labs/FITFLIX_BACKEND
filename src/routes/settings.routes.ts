import { Router } from "express";
import {
	getConferenceSettings,
	updateConferenceSettings,
} from "../controllers/settings.controller";
import {
	getAllAlertRules,
	resetAlertRules,
	updateAlertRule,
} from "../controllers/alert-rule.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const settingsRouter = Router();

// Apply JWT authentication to all admin settings routes
settingsRouter.use(authenticateToken);

settingsRouter.get("/rooms", getConferenceSettings);
settingsRouter.put("/rooms", updateConferenceSettings);

// FX-36: Alert Rules & Escalation Matrix settings
settingsRouter.get("/alert-rules", authorize(["admin", "frontdesk"]), getAllAlertRules);
settingsRouter.put("/alert-rules/:alertType", authorize(["admin"]), updateAlertRule);
settingsRouter.post("/alert-rules/reset", authorize(["admin"]), resetAlertRules);

export default settingsRouter;
