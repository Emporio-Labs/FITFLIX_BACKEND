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
import { verifyLeadCaptcha } from "../middleware/captcha.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
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

leadRouter.post("/", authorize(["admin", "frontdesk", "doctor", "trainer"]), createLead);
leadRouter.get("/", authorize(["admin", "frontdesk"]), getAllLeads);
leadRouter.get("/stats", authorize(["admin", "frontdesk"]), getLeadStats);
leadRouter.get("/:id", authorize(["admin", "frontdesk", "doctor", "trainer"]), getLeadById);
leadRouter.patch(
	"/:id",
	authorize(["admin", "frontdesk", "doctor", "trainer"]),
	updateLeadById,
);
leadRouter.delete("/:id", authorize(["admin", "frontdesk"]), deleteLeadById);
leadRouter.post("/:id/convert", authorize(["admin", "frontdesk"]), convertLeadToUser);

export default leadRouter;
