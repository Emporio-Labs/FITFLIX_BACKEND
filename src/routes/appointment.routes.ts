import { Router } from "express";
import {
	changeAppointmentStatus,
	createAppointment,
	deleteAppointmentById,
	getAllAppointments,
	getAppointmentById,
	getMyAppointments,
	updateAppointmentById,
} from "../controllers/appointment.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const appointmentRouter = Router();

appointmentRouter.use(authenticateToken);

appointmentRouter.post("/", authorize(["admin"]), createAppointment);
appointmentRouter.get("/", authorize(["admin"]), getAllAppointments);
appointmentRouter.get("/me", authorize(["doctor"]), getMyAppointments);
appointmentRouter.get("/:id", authorize(["admin"]), getAppointmentById);
appointmentRouter.patch(
	"/:id",
	authorize(["admin", "user"]),
	updateAppointmentById,
);
appointmentRouter.delete("/:id", authorize(["admin"]), deleteAppointmentById);
appointmentRouter.patch(
	"/:id/status",
	authorize(["admin", "doctor"]),
	changeAppointmentStatus,
);

export default appointmentRouter;
