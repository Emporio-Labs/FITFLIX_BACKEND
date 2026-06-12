import { Router } from "express";
import {
	createDeletionRequest,
	renderDeleteAccountPage,
} from "../controllers/delete-account.controller";
import { publicDeleteAccountRateLimit } from "../middleware/public-rate-limit.middleware";

const router = Router();

// Render public account deletion request page
router.get("/", publicDeleteAccountRateLimit, renderDeleteAccountPage);

// Log public account deletion request
router.post("/request", publicDeleteAccountRateLimit, createDeletionRequest);

export default router;
