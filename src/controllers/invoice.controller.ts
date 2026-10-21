import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { InvoicePaymentStatus } from "../models/Enums";
import {
	createInvoice,
	findInvoiceByIdempotencyKey,
	getInvoiceById,
	InvoiceSaleError,
	getInvoiceForPdf,
	listInvoices,
	transitionInvoiceStatus,
} from "../utils/invoice.service";
import { buildInvoicePdf } from "../utils/invoice-pdf";
import {
	createInvoiceBodySchema,
	idempotencyKeySchema,
	isValidStatusTransition,
	listInvoicesQuerySchema,
	updateInvoiceStatusBodySchema,
} from "../validators/invoice.validator";
import {
	LocationError,
	mapLocationError,
	resolveLocationId,
} from "../utils/location.resolver";
import {
	MembershipOverlapError,
	overlapErrorBody,
} from "../utils/membership-term";

/** Answers the sale's own refusals; false for anything else. */
const sendSaleError = (
	res: Parameters<RequestHandler>[1],
	error: unknown,
): boolean => {
	if (error instanceof MembershipOverlapError) {
		res.status(409).json(overlapErrorBody(error));
		return true;
	}
	if (error instanceof InvoiceSaleError) {
		res.status(error.status).json({ error: error.message, code: error.code });
		return true;
	}
	return false;
};

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

	if (
		parsed.data.userId &&
		!mongoose.Types.ObjectId.isValid(parsed.data.userId)
	) {
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

	if (
		parsed.data.issuedAt &&
		Number.isNaN(new Date(parsed.data.issuedAt).getTime())
	) {
		res
			.status(400)
			.json({ error: "Invalid issuedAt date", code: "BAD_REQUEST" });
		return;
	}

	const { userId, leadId, newLead } = parsed.data;
	if ([userId, leadId, newLead].every((v) => v === undefined)) {
		res.status(400).json({
			error: "One of userId, leadId or newLead is required",
			code: "BAD_REQUEST",
		});
		return;
	}
	if (newLead && (userId || leadId)) {
		res.status(400).json({
			error: "Send newLead on its own, without userId or leadId",
			code: "BAD_REQUEST",
		});
		return;
	}
	if (
		parsed.data.planId &&
		!mongoose.Types.ObjectId.isValid(parsed.data.planId)
	) {
		res.status(400).json({ error: "Invalid planId", code: "BAD_REQUEST" });
		return;
	}

	const rawKey = req.get("Idempotency-Key");
	const parsedKey =
		rawKey === undefined ? undefined : idempotencyKeySchema.safeParse(rawKey);
	if (parsedKey && !parsedKey.success) {
		res.status(400).json({
			error: "Idempotency-Key must be 1–200 characters",
			code: "BAD_REQUEST",
		});
		return;
	}
	const idempotencyKey = parsedKey?.data;
	const actorId = req.user?.id ?? "";

	// Same key from the same staff member: the first submit already created
	// the invoice (and the account), so hand that back instead of a second one.
	if (idempotencyKey) {
		try {
			const existing = await findInvoiceByIdempotencyKey(
				actorId,
				idempotencyKey,
			);
			if (existing) {
				res
					.status(200)
					.json({ message: "Invoice already created", invoice: existing });
				return;
			}
		} catch (error) {
			next(error);
			return;
		}
	}

	// The branch this invoice is issued at, honoured as sent. With one active
	// location the resolver supplies it; with several the desk must send one.
	const rawLocationId = parsed.data.locationId;
	let resolvedLocationId: mongoose.Types.ObjectId | undefined;
	try {
		resolvedLocationId = await resolveLocationId(
			typeof rawLocationId === "string" ? rawLocationId : undefined,
		);
	} catch (error) {
		if (error instanceof LocationError) {
			const mapped = mapLocationError(error);
			res
				.status(mapped.status)
				.json({ error: mapped.message, code: mapped.code });
			return;
		}
		next(error);
		return;
	}

	try {
		const invoice = await createInvoice(
			parsed.data,
			actorId,
			resolvedLocationId,
			idempotencyKey,
		);
		res.status(201).json({ message: "Invoice created", invoice });
	} catch (error) {
		if (sendSaleError(res, error)) return;
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

export const updateInvoiceStatusHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
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
			parsed.data.paymentMethod as Parameters<
				typeof transitionInvoiceStatus
			>[2],
			{
				paymentReference: parsed.data.paymentReference,
				recordedBy: req.user?.id,
				membershipStartDate: parsed.data.membershipStartDate,
			},
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
		if (sendSaleError(res, error)) return;
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

		const doc = buildInvoicePdf(
			invoice as Parameters<typeof buildInvoicePdf>[0],
		);
		doc.pipe(res);
	} catch (error) {
		next(error);
	}
};
