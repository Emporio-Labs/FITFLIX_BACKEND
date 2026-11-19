import { Router } from "express";
import {
	createInvoiceHandler,
	getInvoiceByIdHandler,
	getInvoicePdfHandler,
	listInvoicesHandler,
	updateInvoiceStatusHandler,
} from "../controllers/invoice.controller";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";

const invoiceRouter = Router();

invoiceRouter.use(authenticateToken);

invoiceRouter.post(
	"/",
	authorize(["admin", "frontdesk", "manager"]),
	createInvoiceHandler,
);
invoiceRouter.get(
	"/",
	authorize(["admin", "frontdesk", "manager"]),
	listInvoicesHandler,
);
invoiceRouter.get(
	"/:id",
	authorize(["admin", "frontdesk", "manager"]),
	getInvoiceByIdHandler,
);
invoiceRouter.patch(
	"/:id/status",
	authorize(["admin", "frontdesk", "manager"]),
	updateInvoiceStatusHandler,
);
invoiceRouter.get(
	"/:id/pdf",
	authorize(["admin", "frontdesk", "manager"]),
	getInvoicePdfHandler,
);

export default invoiceRouter;
