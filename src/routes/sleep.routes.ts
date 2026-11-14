import { Router } from "express";
import {
	deleteSleepLogHandler,
	getSleepSeriesHandler,
	logSleepHandler,
} from "../controllers/sleep.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

router.post("/log", authorize(["user"]), logSleepHandler);
router.get("/series", authorize(["user", "admin", "trainer"]), getSleepSeriesHandler);
router.get("/", authorize(["user", "admin", "trainer"]), getSleepSeriesHandler);
router.delete("/log/:id", authorize(["user"]), deleteSleepLogHandler);

export default router;
