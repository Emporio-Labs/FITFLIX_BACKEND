import { type RequestHandler, Router } from "express";
import multer from "multer";
import {
	createPromotion,
	deletePromotionById,
	getAllPromotions,
	getPromotionById,
	getPublicPromotions,
	updatePromotionById,
	uploadPromotionImage,
} from "../controllers/promotion.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import {
	uploadMiddleware,
	uploadRateLimiter,
} from "../middleware/upload.middleware";

const router = Router();

/** Single banner image, field name `image`. Multer errors become clean 4xx. */
const uploadImageMulter: RequestHandler = (req, res, next) => {
	uploadMiddleware.single("image")(req, res, (err: unknown) => {
		if (!err) {
			next();
			return;
		}
		if (err instanceof multer.MulterError) {
			const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
			res
				.status(status)
				.json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		res.status(415).json({
			error: (err as Error).message || "Unsupported file",
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
};

// ── Pre-login — the visitor home screen carries promotions too ──
// Registered before authenticateToken, following therapy.routes.ts.
router.get("/public", getPublicPromotions);

router.use(authenticateToken);

// ── Discovery — every authenticated role reads the same live set, except
// staff, who may pass ?includeInactive=true ──
router.get("/", getAllPromotions);
router.get("/:id", getPromotionById);

// ── Administration ──
router.post(
	"/image",
	authorize(["admin"]),
	uploadRateLimiter,
	uploadImageMulter,
	uploadPromotionImage,
);
router.post("/", authorize(["admin"]), createPromotion);
router.patch("/:id", authorize(["admin"]), updatePromotionById);
router.delete("/:id", authorize(["admin"]), deletePromotionById);

export default router;
