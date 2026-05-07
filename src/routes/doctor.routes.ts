import { Router } from "express";
import {
	createDoctor,
	deleteDoctorById,
	getAllDoctors,
	getDoctorById,
	getPublicDoctorById,
	getPublicDoctors,
	updateDoctorById,
} from "../controllers/doctor.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const doctorRouter = Router();

doctorRouter.get("/public", getPublicDoctors);
doctorRouter.get("/public/:id", getPublicDoctorById);

doctorRouter.use(authenticateToken);
doctorRouter.post("/", authorize(["admin"]), createDoctor);
doctorRouter.get("/", authorize(["admin"]), getAllDoctors);
doctorRouter.get("/:id", authorize(["doctor", "trainer"]), getDoctorById);
doctorRouter.patch("/:id", authorize(["doctor", "trainer"]), updateDoctorById);
doctorRouter.delete("/:id", authorize(["admin"]), deleteDoctorById);

export default doctorRouter;
