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
	authorize(["admin", "frontdesk"]),
	createInvoiceHandler,
);
invoiceRouter.get("/", authorize(["admin", "frontdesk"]), listInvoicesHandler);
invoiceRouter.get(
	"/:id",
	authorize(["admin", "frontdesk"]),
	getInvoiceByIdHandler,
);
invoiceRouter.patch(
	"/:id/status",
	authorize(["admin", "frontdesk"]),
	updateInvoiceStatusHandler,
);
invoiceRouter.get(
	"/:id/pdf",
	authorize(["admin", "frontdesk"]),
	getInvoicePdfHandler,
);

export default invoiceRouter;
