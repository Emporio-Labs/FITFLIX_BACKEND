import { Router } from "express";
import {
	getExpertDirectory,
	getExpertScheduleHandler,
	getPooledAvailability,
	updateExpertScheduleHandler,
} from "../controllers/expert-schedule.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const expertScheduleRouter = Router();

expertScheduleRouter.use(authenticateToken);

// ── Discovery ────────────────────────────────────────────────────────────────
// Any authenticated caller: the member app needs the pool to show times, the
// front desk needs it to staff the queue.
expertScheduleRouter.get("/:expertType/availability", getPooledAvailability);
expertScheduleRouter.get("/:expertType", getExpertDirectory);

// ── Schedule read / write ────────────────────────────────────────────────────
// `:expertId` accepts the literal "me", so an expert never needs their own id.
// Write access is narrowed further inside the handler: admin and frontdesk may
// edit anyone, every other role only itself.
expertScheduleRouter.get("/:expertType/:expertId/schedule", getExpertScheduleHandler);
expertScheduleRouter.put(
	"/:expertType/:expertId/schedule",
	authorize([
		"admin",
		"frontdesk",
		"trainer",
		"nutritionist",
		"sports_scientist",
		"doctor",
	]),
	updateExpertScheduleHandler,
);

export default expertScheduleRouter;
