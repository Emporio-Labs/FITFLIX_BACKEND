import { Router } from "express";
import { getAdminWaitlistHandler } from "../controllers/booking.controller";
import {
	createScheduledSession,
	getAllSchedulesForAdmin,
	getScheduledSessionByIdForMembers,
	getSchedulesForMembers,
	updateScheduledSession,
	updateSessionCapacity,
} from "../controllers/class-schedule.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const classScheduleRouter = Router();

classScheduleRouter.use(authenticateToken);

// Admin Schedule Management Endpoints
classScheduleRouter.post(
	"/admin/classes/schedule",
	authorize(["admin"]),
	createScheduledSession,
);
classScheduleRouter.get(
	"/admin/classes/schedule",
	authorize(["admin"]),
	getAllSchedulesForAdmin,
);
classScheduleRouter.get(
	"/admin/classes/schedule/:id/waitlist",
	authorize(["admin"]),
	(req, res, next) => {
		req.query.sessionId = req.params.id;
		return getAdminWaitlistHandler(req, res, next);
	},
);
classScheduleRouter.patch(
	"/admin/classes/schedule/:id",
	authorize(["admin"]),
	updateScheduledSession,
);
classScheduleRouter.patch(
	"/admin/classes/schedule/:id/capacity",
	authorize(["admin"]),
	updateSessionCapacity,
);

// Member Schedule Query Endpoints
classScheduleRouter.get(
	"/classes/schedule",
	authorize(["admin", "trainer", "user"]),
	getSchedulesForMembers,
);
classScheduleRouter.get(
	"/classes/schedule/:id",
	authorize(["admin", "trainer", "user"]),
	getScheduledSessionByIdForMembers,
);

export default classScheduleRouter;
