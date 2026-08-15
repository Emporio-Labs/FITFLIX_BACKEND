import { Router } from "express";
import {
	createPromotion,
	deletePromotionById,
	getAllPromotions,
	getPromotionById,
	getPublicPromotions,
	updatePromotionById,
} from "../controllers/promotion.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

// ── Pre-login — the visitor home screen carries promotions too ──
// Registered before authenticateToken, following therapy.routes.ts.
router.get("/public", getPublicPromotions);

router.use(authenticateToken);

// ── Discovery — every authenticated role reads the same live set, except
// staff, who may pass ?includeInactive=true ──
router.get("/", getAllPromotions);
router.get("/:id", getPromotionById);

// ── Administration ──
router.post("/", authorize(["admin"]), createPromotion);
router.patch("/:id", authorize(["admin"]), updatePromotionById);
router.delete("/:id", authorize(["admin"]), deletePromotionById);

export default router;
