import { Router } from "express";
import {
	adminCancelAppointment,
	adminGetAppointment,
	adminListAppointments,
	bookAppointment,
	cancelAppointment,
	getAvailability,
	getMyAppointments,
	rescheduleAppointment,
} from "../controllers/expert-appointment.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

// ─── User routes — /expert-appointments ──────────────────────────────────────
const userRouter = Router();
userRouter.use(authenticateToken);
userRouter.use(authorize(["user"]));

userRouter.get("/availability", getAvailability);
userRouter.post("/book", bookAppointment);
userRouter.get("/me", getMyAppointments);
userRouter.patch("/:id/reschedule", rescheduleAppointment);
userRouter.patch("/:id/cancel", cancelAppointment);

// ─── Admin routes — /admin/expert-appointments ────────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticateToken);
adminRouter.use(authorize(["admin"]));

adminRouter.get("/", adminListAppointments);
adminRouter.get("/:id", adminGetAppointment);
adminRouter.patch("/:id/cancel", adminCancelAppointment);

export {
	adminRouter as adminExpertAppointmentRouter,
	userRouter as expertAppointmentRouter,
};
