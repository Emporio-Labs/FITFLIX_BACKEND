import { Router } from "express";
import {
	copyLocationSettings,
	createLocation,
	deleteLocationById,
	getAllLocations,
	getLocationById,
	getLocationSettingsById,
	updateLocationById,
	updateLocationSettingsById,
} from "../controllers/location.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

// ── Discovery — any authenticated role needs to know which branches exist ──
router.get("/", getAllLocations);
router.get("/:id", getLocationById);

// ── Branch administration ──
router.post("/", authorize(["admin"]), createLocation);
router.patch("/:id", authorize(["admin"]), updateLocationById);
router.delete("/:id", authorize(["admin"]), deleteLocationById);

// ── Per-location settings ──
router.get(
	"/:id/settings",
	authorize(["admin", "frontdesk"]),
	getLocationSettingsById,
);
router.put("/:id/settings", authorize(["admin"]), updateLocationSettingsById);
router.post(
	"/:id/settings/copy-from/:sourceId",
	authorize(["admin"]),
	copyLocationSettings,
);

export default router;
