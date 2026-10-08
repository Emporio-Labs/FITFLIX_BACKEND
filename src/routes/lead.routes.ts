import { Router } from "express";
import {
	addLeadInteraction,
	claimLead,
	convertLeadToUser,
	createLead,
	createPublicLead,
	deleteLeadById,
	getAllLeads,
	getLeadById,
	getLeadStats,
	getTeamPerformance,
	reassignLead,
	recordLeadContactAttempt,
	updateLeadById,
} from "../controllers/lead.controller";
import { verifyLeadCaptcha } from "../middleware/captcha.middleware";
import { staffGuard } from "../middleware/branch-scope.middleware";
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
leadRouter.use(...staffGuard);

leadRouter.post(
	"/",
	authorize(["admin", "frontdesk", "trainer"]),
	createLead,
);
leadRouter.get("/", authorize(["admin", "frontdesk"]), getAllLeads);
leadRouter.get("/stats", authorize(["admin", "frontdesk"]), getLeadStats);
// FX-34.4 — per-person performance for the branch manager's view.
leadRouter.get(
	"/team-performance",
	authorize(["admin", "frontdesk"]),
	getTeamPerformance,
);
leadRouter.get(
	"/:id",
	authorize(["admin", "frontdesk", "trainer"]),
	getLeadById,
);
leadRouter.patch(
	"/:id",
	authorize(["admin", "frontdesk", "trainer"]),
	updateLeadById,
);
leadRouter.delete("/:id", authorize(["admin", "frontdesk"]), deleteLeadById);
// FX-33.2/.3 — claim an unclaimed lead from the branch queue.
leadRouter.post("/:id/claim", authorize(["admin", "frontdesk"]), claimLead);
// FX-34.1/.3 — reassign a lead to another staff member, or release it to the
// queue. The manager-vs-sales distinction (sales may only release their own) is
// enforced in the controller from the caller's live staff role.
leadRouter.post(
	"/:id/reassign",
	authorize(["admin", "frontdesk"]),
	reassignLead,
);
// FX-33.5 — notes and contact attempts, attributed to the acting staff member.
leadRouter.post(
	"/:id/interactions",
	authorize(["admin", "frontdesk", "trainer"]),
	addLeadInteraction,
);
leadRouter.post(
	"/:id/contact-attempt",
	authorize(["admin", "frontdesk", "trainer"]),
	recordLeadContactAttempt,
);
leadRouter.post(
	"/:id/convert",
	authorize(["admin", "frontdesk"]),
	convertLeadToUser,
);

export default leadRouter;
