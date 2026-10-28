import { Router } from "express";
import {
	convertLeadToUser,
	createLead,
	createPublicLead,
	deleteLeadById,
	getAllLeads,
	getLeadById,
	getLeadStats,
	updateLeadById,
} from "../controllers/lead.controller";
import {
	createLeadActivity,
	getLeadActivities,
	getLeadAnalytics,
	getLeadOutcomes,
} from "../controllers/lead-activity.controller";
import { verifyLeadCaptcha } from "../middleware/captcha.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { requireLeadAccess } from "../middleware/lead-access.middleware";
import { publicLeadCaptureRateLimit } from "../middleware/public-rate-limit.middleware";
import { authorize } from "../middleware/rbac.middleware";

const leadRouter = Router();

leadRouter.post(
	"/public-capture",
	publicLeadCaptureRateLimit,
	verifyLeadCaptcha,
	createPublicLead,
);

leadRouter.use(authenticateToken);

// Any trainer can add a lead (a referral); seeing and working leads needs
// an admin to grant it (Trainer.canAccessLeads).
const worker = [
	authorize(["admin", "frontdesk", "trainer"]),
	requireLeadAccess,
];

leadRouter.post(
	"/",
	authorize(["admin", "frontdesk", "trainer"]),
	createLead,
);
leadRouter.get("/", ...worker, getAllLeads);
leadRouter.get("/stats", ...worker, getLeadStats);
leadRouter.get("/outcomes", ...worker, getLeadOutcomes);
leadRouter.get("/analytics", authorize(["admin", "frontdesk"]), getLeadAnalytics);
leadRouter.get("/:id", ...worker, getLeadById);
leadRouter.patch("/:id", ...worker, updateLeadById);
leadRouter.get("/:id/activities", ...worker, getLeadActivities);
leadRouter.post("/:id/activities", ...worker, createLeadActivity);
leadRouter.delete("/:id", authorize(["admin", "frontdesk"]), deleteLeadById);
leadRouter.post(
	"/:id/convert",
	authorize(["admin", "frontdesk"]),
	convertLeadToUser,
);

export default leadRouter;
