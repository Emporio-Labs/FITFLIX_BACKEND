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
import { attachStaffContext } from "../middleware/branch-scope.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

// ── Discovery — any authenticated role needs to know which branches exist ──
// FX-18.4/18.1 — attachStaffContext populates req.allowedBranchIds so the list
// below returns only the branches a scoped staffer works at; members no-op
// through it and still see every active branch (they book cross-branch).
router.get("/", attachStaffContext, getAllLocations);
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
