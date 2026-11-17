import { Router } from "express";
import {
	connectWearable,
	disconnectWearable,
	getConnections,
	getMemberWearableSeries,
	getMyWearableSeries,
	getWearableConsent,
	syncWearable,
	updateWearableConsent,
} from "../controllers/wearable.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

// ── Member: consent (withdrawal is as easy as granting, and deletes data) ──
router.get("/consent", authorize(["user"]), getWearableConsent);
router.patch("/consent", authorize(["user"]), updateWearableConsent);

// ── Member: connections and sync ──
router.get("/connections", authorize(["user"]), getConnections);
router.post("/connections", authorize(["user"]), connectWearable);
router.delete("/connections/:source", authorize(["user"]), disconnectWearable);
router.post("/sync", authorize(["user"]), syncWearable);
router.get("/daily", authorize(["user"]), getMyWearableSeries);

// ── Staff: only the member's own coach (or admin), only if the member shared ──
router.get(
	"/members/:userId/daily",
	authorize(["admin", "trainer", "nutritionist"]),
	getMemberWearableSeries,
);

export default router;
