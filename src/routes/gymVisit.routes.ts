import { Router } from "express";
import {
	checkInMember,
	checkOutVisit,
	getMyVisits,
	getVisitAnalytics,
	issueQrToken,
	listCurrentlyIn,
	listVisits,
	qrCheckIn,
} from "../controllers/gymVisit.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const gymVisitRouter = Router();

gymVisitRouter.use(authenticateToken);

// Members read only their own history.
gymVisitRouter.get("/me", getMyVisits);

// Member fetches their rotating gym-entry QR token.
gymVisitRouter.get("/qr-token", issueQrToken);

// Admin/front-desk manage attendance.
gymVisitRouter.get(
	"/currently-in",
	authorize(["admin", "frontdesk"]),
	listCurrentlyIn,
);
gymVisitRouter.get(
	"/analytics",
	authorize(["admin", "frontdesk"]),
	getVisitAnalytics,
);
gymVisitRouter.get("/", authorize(["admin", "frontdesk"]), listVisits);
gymVisitRouter.post(
	"/check-in",
	authorize(["admin", "frontdesk"]),
	checkInMember,
);
gymVisitRouter.post(
	"/qr-check-in",
	authorize(["admin", "frontdesk"]),
	qrCheckIn,
);
gymVisitRouter.patch(
	"/:id/check-out",
	authorize(["admin", "frontdesk"]),
	checkOutVisit,
);

export default gymVisitRouter;
