import { Router } from "express";
import {
	deleteSleepLogHandler,
	getSleepCheckInHandler,
	getSleepSeriesHandler,
	logSleepHandler,
	resumeSleepCheckInHandler,
} from "../controllers/sleep.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

router.post("/log", authorize(["user"]), logSleepHandler);
router.get("/series", authorize(["user", "admin", "trainer"]), getSleepSeriesHandler);
router.get("/", authorize(["user", "admin", "trainer"]), getSleepSeriesHandler);
router.delete("/log/:id", authorize(["user"]), deleteSleepLogHandler);
// Morning sleep check-in (services/sleep-checkin.service.ts)
router.get("/check-in", authorize(["user"]), getSleepCheckInHandler);
router.post("/check-in/resume", authorize(["user"]), resumeSleepCheckInHandler);

export default router;
