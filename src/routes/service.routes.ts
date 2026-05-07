import { Router } from "express";
import {
	createService,
	deleteServiceById,
	getAllServices,
	getServiceById,
	updateServiceById,
} from "../controllers/service.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const serviceRouter = Router();

serviceRouter.use(authenticateToken);
serviceRouter.get(
	"/",
	authorize(["admin", "doctor", "trainer", "user"]),
	getAllServices,
);
serviceRouter.get(
	"/:id",
	authorize(["admin", "doctor", "trainer", "user"]),
	getServiceById,
);
serviceRouter.post("/", authorize(["admin"]), createService);
serviceRouter.patch("/:id", authorize(["admin"]), updateServiceById);
serviceRouter.delete("/:id", authorize(["admin"]), deleteServiceById);

export default serviceRouter;
