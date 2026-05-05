import express from "express";
import {
	createSchedule,
	deleteSchedule,
	getMySchedule,
	getScheduleByUserId,
	rescheduleSchedule,
	updateSchedule,
} from "../controllers/schedule.controller";
import { authenticateBasicCredentials } from "../middleware/basic-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const scheduleRouter = express.Router();

// All routes require authentication
scheduleRouter.use(authenticateBasicCredentials);

// User can view their own schedule
scheduleRouter.get("/my-schedule", getMySchedule);

// Create schedule: User for themselves, Doctor/Trainer/Admin for any user
scheduleRouter.post(
	"/",
	authorize(["user", "doctor", "trainer", "admin"]),
	createSchedule,
);

// View schedule: User for themselves, Doctor/Trainer/Admin for any user
scheduleRouter.get(
	"/:userId",
	authorize(["user", "doctor", "trainer", "admin"]),
	getScheduleByUserId,
);

// Edit schedule: User for themselves, Doctor/Trainer/Admin for any user
scheduleRouter.patch(
	"/:userId",
	authorize(["user", "doctor", "trainer", "admin"]),
	updateSchedule,
);

// Reschedule: User for themselves, Doctor/Trainer/Admin for any user (within 7 days only)
scheduleRouter.patch(
	"/:userId/reschedule",
	authorize(["user", "doctor", "trainer", "admin"]),
	rescheduleSchedule,
);

// Delete schedule: Admin only
scheduleRouter.delete("/:userId", authorize(["admin"]), deleteSchedule);

export default scheduleRouter;
