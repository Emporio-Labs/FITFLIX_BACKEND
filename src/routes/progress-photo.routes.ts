import { Router } from "express";
import {
	deleteMyProgressPhoto,
	getMemberComparisonForStaff,
	getMemberProgressPhotosForStaff,
	getMyComparison,
	getMyProgressPhotos,
	uploadProgressPhoto,
} from "../controllers/progress-photo.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware, uploadRateLimiter } from "../middleware/upload.middleware";

const progressPhotoRouter = Router();

progressPhotoRouter.use(authenticateToken);

// Member routes
progressPhotoRouter.post(
	"/",
	authorize(["user"]),
	uploadRateLimiter,
	uploadMiddleware.single("file"),
	uploadProgressPhoto,
);
progressPhotoRouter.get("/me", authorize(["user"]), getMyProgressPhotos);
progressPhotoRouter.get("/me/compare", authorize(["user"]), getMyComparison);
progressPhotoRouter.delete("/:id", authorize(["user"]), deleteMyProgressPhoto);

// Staff routes (admin, frontdesk, assigned trainer, assigned nutritionist)
progressPhotoRouter.get(
	"/user/:userId",
	authorize(["admin", "frontdesk", "trainer", "nutritionist"]),
	getMemberProgressPhotosForStaff,
);
progressPhotoRouter.get(
	"/user/:userId/compare",
	authorize(["admin", "frontdesk", "trainer", "nutritionist"]),
	getMemberComparisonForStaff,
);

export default progressPhotoRouter;
