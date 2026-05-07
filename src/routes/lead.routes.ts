import { Router } from "express";
import {
	convertLeadToUser,
	createLead,
	createPublicLead,
	deleteLeadById,
	getAllLeads,
	getLeadById,
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

leadRouter.post("/", authorize(["admin", "doctor", "trainer"]), createLead);
leadRouter.get("/", authorize(["admin"]), getAllLeads);
leadRouter.get("/:id", authorize(["admin", "doctor", "trainer"]), getLeadById);
leadRouter.patch(
	"/:id",
	authorize(["admin", "doctor", "trainer"]),
	updateLeadById,
);
leadRouter.delete("/:id", authorize(["admin"]), deleteLeadById);
leadRouter.post("/:id/convert", authorize(["admin"]), convertLeadToUser);

export default leadRouter;
