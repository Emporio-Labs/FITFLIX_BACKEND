import { Router } from "express";
import {
	acknowledgeOperationalAlert,
	createOperationalAlert,
	exportAlertReportCsvHandler,
	getAlertSlaReportHandler,
	getOperationalAlerts,
	resolveOperationalAlert,
} from "../controllers/operational-alert.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const router = Router();

router.use(authenticateToken);

// FX-44.1 - FX-44.3: Alert SLA & Accountability Reports
router.get("/reports", authorize(["admin", "frontdesk"]), getAlertSlaReportHandler);

// FX-44.4: Export reports as CSV spreadsheet
router.get("/reports/export", authorize(["admin", "frontdesk"]), exportAlertReportCsvHandler);

// FX-35.3 & FX-35.5: Staff only see alerts for their own branch/role
router.get("/", authorize(["admin", "frontdesk", "trainer"]), getOperationalAlerts);

// FX-35.1: Create operational alert
router.post("/", authorize(["admin", "frontdesk"]), createOperationalAlert);

// FX-35.2 & FX-35.4: Acknowledge alert (records named user & timestamp)
router.patch("/:id/acknowledge", authorize(["admin", "frontdesk", "trainer"]), acknowledgeOperationalAlert);

// FX-35.2 & FX-35.4: Resolve alert
router.patch("/:id/resolve", authorize(["admin", "frontdesk"]), resolveOperationalAlert);

export default router;
