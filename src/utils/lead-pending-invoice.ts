import mongoose from "mongoose";
import { InvoicePaymentStatus } from "../models/Enums";
import Invoice from "../models/Invoice";

/** An invoice the desk can still take payment on. */
export const OPEN_INVOICE_STATUSES = [
	InvoicePaymentStatus.DRAFT,
	InvoicePaymentStatus.PENDING,
];

/**
 * Each lead's newest DRAFT/PENDING invoice id, keyed by lead id. One query for
 * the whole list, so a lead list never asks once per lead. Leads without an
 * open invoice are absent from the map.
 */
export const pendingInvoiceIdsByLead = async (
	leadIds: Array<mongoose.Types.ObjectId | string>,
): Promise<Map<string, string>> => {
	if (leadIds.length === 0) return new Map();

	const rows = await Invoice.aggregate<{
		_id: mongoose.Types.ObjectId;
		invoiceId: mongoose.Types.ObjectId;
	}>([
		{
			$match: {
				leadId: {
					$in: leadIds.map((id) => new mongoose.Types.ObjectId(String(id))),
				},
				paymentStatus: { $in: OPEN_INVOICE_STATUSES },
			},
		},
		{ $sort: { createdAt: -1 } },
		{ $group: { _id: "$leadId", invoiceId: { $first: "$_id" } } },
	]);

	return new Map(rows.map((r) => [String(r._id), String(r.invoiceId)]));
};
