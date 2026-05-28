import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { InvoicePaymentStatus } from "../models/Enums";
import {
	createInvoiceBodySchema,
	isValidStatusTransition,
	listInvoicesQuerySchema,
	updateInvoiceStatusBodySchema,
} from "../validators/invoice.validator";
import { buildInvoicePdf } from "../utils/invoice-pdf";
import {
	createInvoice,
	getInvoiceById,
	getInvoiceForPdf,
	listInvoices,
	transitionInvoiceStatus,
} from "../utils/invoice.service";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

export const createInvoiceHandler: RequestHandler = async (req, res, next) => {
	const parsed = createInvoiceBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues.reduce<Record<string, string>>(
				(acc, issue) => {
					const key = issue.path.map(String).join(".") || "body";
					if (!acc[key]) acc[key] = issue.message;
					return acc;
				},
				{},
			),
		});
		return;
	}

	if (!mongoose.Types.ObjectId.isValid(parsed.data.userId)) {
		res.status(400).json({ error: "Invalid userId", code: "BAD_REQUEST" });
		return;
	}

	if (
		parsed.data.leadId &&
		!mongoose.Types.ObjectId.isValid(parsed.data.leadId)
	) {
		res.status(400).json({ error: "Invalid leadId", code: "BAD_REQUEST" });
		return;
	}

	if (parsed.data.issuedAt && Number.isNaN(new Date(parsed.data.issuedAt).getTime())) {
		res.status(400).json({ error: "Invalid issuedAt date", code: "BAD_REQUEST" });
		return;
	}

	try {
		const invoice = await createInvoice(parsed.data, req.user!.id);
		res.status(201).json({ message: "Invoice created", invoice });
	} catch (error) {
		next(error);
	}
};

export const listInvoicesHandler: RequestHandler = async (req, res, next) => {
	const parsed = listInvoicesQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Invalid query parameters",
			code: "BAD_REQUEST",
		});
		return;
	}

	try {
		const invoices = await listInvoices(parsed.data);
		res.status(200).json({ invoices });
	} catch (error) {
		next(error);
	}
};

export const getInvoiceByIdHandler: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid invoice id", code: "BAD_REQUEST" });
		return;
	}

	try {
		const invoice = await getInvoiceById(id);
		if (!invoice) {
			res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
			return;
		}
		res.status(200).json({ invoice });
	} catch (error) {
		next(error);
	}
};

export const updateInvoiceStatusHandler: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid invoice id", code: "BAD_REQUEST" });
		return;
	}

	const parsed = updateInvoiceStatusBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: parsed.error.issues.reduce<Record<string, string>>(
				(acc, issue) => {
					const key = issue.path.map(String).join(".") || "body";
					if (!acc[key]) acc[key] = issue.message;
					return acc;
				},
				{},
			),
		});
		return;
	}

	try {
		const existing = await getInvoiceById(id);
		if (!existing) {
			res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
			return;
		}

		const currentStatus = existing.paymentStatus as string;
		const newStatus = parsed.data.paymentStatus;

		if (currentStatus === newStatus) {
			res.status(200).json({ message: "No status change", invoice: existing });
			return;
		}

		if (!isValidStatusTransition(currentStatus, newStatus)) {
			res.status(409).json({
				error: `Cannot transition invoice from ${currentStatus} to ${newStatus}`,
				code: "CONFLICT",
			});
			return;
		}

		const result = await transitionInvoiceStatus(
			id,
			newStatus as InvoicePaymentStatus,
			parsed.data.paymentMethod as Parameters<typeof transitionInvoiceStatus>[2],
		);

		if (!result.invoice) {
			res.status(409).json({
				error: "Invoice was already marked as PAID",
				code: "CONFLICT",
			});
			return;
		}

		const isPaid = newStatus === InvoicePaymentStatus.PAID;
		res.status(200).json({
			message: isPaid
				? "Invoice marked as PAID. Lead converted and membership activated."
				: `Invoice status updated to ${newStatus}`,
			invoice: result.invoice,
			...(isPaid && result.lead ? { lead: result.lead } : {}),
			...(isPaid && result.membership ? { membership: result.membership } : {}),
		});
	} catch (error) {
		next(error);
	}
};

export const getInvoicePdfHandler: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid invoice id", code: "BAD_REQUEST" });
		return;
	}

	try {
		const invoice = await getInvoiceForPdf(id);
		if (!invoice) {
			res.status(404).json({ error: "Invoice not found", code: "NOT_FOUND" });
			return;
		}

		res.setHeader("Content-Type", "application/pdf");
		res.setHeader(
			"Content-Disposition",
			`attachment; filename="${invoice.invoiceNumber}.pdf"`,
		);

		const doc = buildInvoicePdf(invoice as Parameters<typeof buildInvoicePdf>[0]);
		doc.pipe(res);
	} catch (error) {
		next(error);
	}
};
