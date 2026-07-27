import { Router } from "express";
import {
	createScheduledSession,
	getAllSchedulesForAdmin,
	getSchedulesForMembers,
	updateScheduledSession,
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
classScheduleRouter.patch(
	"/admin/classes/schedule/:id",
	authorize(["admin"]),
	updateScheduledSession,
);

// Member Schedule Query Endpoints
classScheduleRouter.get(
	"/classes/schedule",
	authorize(["admin", "trainer", "user"]),
	getSchedulesForMembers,
);

export default classScheduleRouter;
