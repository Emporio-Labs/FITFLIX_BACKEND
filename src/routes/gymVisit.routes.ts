import { Router } from "express";
import {
	checkInMember,
	checkOutVisit,
	deleteVisit,
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

// Admin/front-desk/manager manage attendance.
gymVisitRouter.get(
	"/currently-in",
	authorize(["admin", "frontdesk", "manager"]),
	listCurrentlyIn,
);
gymVisitRouter.get(
	"/analytics",
	authorize(["admin", "frontdesk", "manager"]),
	getVisitAnalytics,
);
gymVisitRouter.get(
	"/",
	authorize(["admin", "frontdesk", "manager"]),
	listVisits,
);
gymVisitRouter.post(
	"/check-in",
	authorize(["admin", "frontdesk", "manager"]),
	checkInMember,
);
gymVisitRouter.post(
	"/qr-check-in",
	authorize(["admin", "frontdesk", "manager"]),
	qrCheckIn,
);
gymVisitRouter.patch(
	"/:id/check-out",
	authorize(["admin", "frontdesk", "manager"]),
	checkOutVisit,
);
gymVisitRouter.delete(
	"/:id",
	authorize(["admin", "frontdesk", "manager"]),
	deleteVisit,
);

export default gymVisitRouter;
