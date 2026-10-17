import { Router } from "express";
import {
	createDnaTest,
	deleteDnaTest,
	getAllDnaTests,
	getMyDnaReports,
	updateDnaTest,
} from "../controllers/dna.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { uploadMiddleware, uploadRateLimiter } from "../middleware/upload.middleware";

const dnaRouter = Router();

dnaRouter.use(authenticateToken);

// Member endpoint
dnaRouter.get("/reports", authorize(["user"]), getMyDnaReports);

// Staff / Admin endpoints
dnaRouter.get(
	"/tests",
	authorize(["admin", "frontdesk", "doctor", "nutritionist"]),
	getAllDnaTests,
);

dnaRouter.post(
	"/tests",
	authorize(["admin", "frontdesk", "doctor", "nutritionist"]),
	uploadRateLimiter,
	uploadMiddleware.single("file"),
	createDnaTest,
);

dnaRouter.patch(
	"/tests/:id",
	authorize(["admin", "frontdesk", "doctor", "nutritionist"]),
	uploadRateLimiter,
	uploadMiddleware.single("file"),
	updateDnaTest,
);

dnaRouter.delete(
	"/tests/:id",
	authorize(["admin", "frontdesk"]),
	deleteDnaTest,
);

export default dnaRouter;
