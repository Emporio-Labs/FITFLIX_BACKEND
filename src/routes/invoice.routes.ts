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
invoiceRouter.use(authorize(["admin"]));

invoiceRouter.post("/", createInvoiceHandler);
invoiceRouter.get("/", listInvoicesHandler);
invoiceRouter.get("/:id", getInvoiceByIdHandler);
invoiceRouter.patch("/:id/status", updateInvoiceStatusHandler);
invoiceRouter.get("/:id/pdf", getInvoicePdfHandler);

export default invoiceRouter;
