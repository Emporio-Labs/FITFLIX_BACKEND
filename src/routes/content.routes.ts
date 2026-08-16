import { Router } from "express";
import {
	createContentOverride,
	deleteContentOverrideById,
	getAllContentOverrides,
	getPublicContent,
	updateContentOverrideById,
} from "../controllers/content.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

// ── Pre-login — the landing page reads copy before anyone has an account ──
// Registered before authenticateToken, following promotion.routes.ts.
router.get("/public", getPublicContent);

router.use(authenticateToken);

// ── Administration — copy is edited by staff, never read back by the app ──
router.get("/", authorize(["admin"]), getAllContentOverrides);
router.post("/", authorize(["admin"]), createContentOverride);
router.patch("/:id", authorize(["admin"]), updateContentOverrideById);
router.delete("/:id", authorize(["admin"]), deleteContentOverrideById);

export default router;
