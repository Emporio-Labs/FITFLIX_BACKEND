import mongoose from "mongoose";
import { InvoicePaymentMethod, InvoicePaymentStatus, LeadStatus, MembershipStatus } from "../models/Enums";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Membership from "../models/Membership";
import type { CreateInvoiceBody, ListInvoicesQuery } from "../validators/invoice.validator";
import { generateInvoiceNumber } from "./invoice-number";

export const createInvoice = async (
	data: CreateInvoiceBody,
	createdById: string,
) => {
	const invoiceNumber = await generateInvoiceNumber();

	const subtotal = data.items.reduce(
		(sum, item) => sum + item.price * item.quantity,
		0,
	);
	const total = Math.max(0, subtotal + data.tax - data.discount);

	const invoice = await Invoice.create({
		invoiceNumber,
		userId: new mongoose.Types.ObjectId(data.userId),
		...(data.leadId ? { leadId: new mongoose.Types.ObjectId(data.leadId) } : {}),
		items: data.items,
		subtotal,
		tax: data.tax,
		discount: data.discount,
		total,
		planSnapshot: data.planSnapshot,
		paymentStatus: data.paymentStatus,
		paymentMethod: data.paymentMethod,
		...(data.issuedAt ? { issuedAt: new Date(data.issuedAt) } : {}),
		createdBy: new mongoose.Types.ObjectId(createdById),
	});

	return invoice;
};

export const listInvoices = async (query: ListInvoicesQuery) => {
	const filter: Record<string, unknown> = {};

	if (query.paymentStatus) {
		filter.paymentStatus = query.paymentStatus;
	}

	if (query.userId && mongoose.Types.ObjectId.isValid(query.userId)) {
		filter.userId = new mongoose.Types.ObjectId(query.userId);
	}

	if (query.from || query.to) {
		const dateFilter: Record<string, Date> = {};
		if (query.from) {
			const from = new Date(query.from);
			if (!Number.isNaN(from.getTime())) dateFilter.$gte = from;
		}
		if (query.to) {
			const to = new Date(query.to);
			if (!Number.isNaN(to.getTime())) dateFilter.$lte = to;
		}
		if (Object.keys(dateFilter).length > 0) {
			filter.createdAt = dateFilter;
		}
	}

	return Invoice.find(filter)
		.populate("userId", "username email phone")
		.populate("leadId", "leadName email phone status")
		.sort({ createdAt: -1 });
};

export const getInvoiceById = async (id: string) => {
	return Invoice.findById(id)
		.populate("userId", "username email phone")
		.populate("leadId", "leadName email phone status");
};

export const getInvoiceForPdf = async (id: string) => {
	return Invoice.findById(id)
		.populate<{ userId: { username: string; email: string; phone?: string } }>(
			"userId",
			"username email phone",
		);
};

export const transitionInvoiceStatus = async (
	id: string,
	newStatus: InvoicePaymentStatus,
	paymentMethod?: InvoicePaymentMethod,
): Promise<{
	invoice: unknown;
	lead?: unknown;
	membership?: unknown;
}> => {
	if (newStatus !== InvoicePaymentStatus.PAID) {
		const invoice = await Invoice.findOneAndUpdate(
			{ _id: id },
			{
				paymentStatus: newStatus,
				...(paymentMethod ? { paymentMethod } : {}),
				// $min sets issuedAt to now only when the field is unset (missing field gets the value; existing earlier date is preserved)
				...(newStatus === InvoicePaymentStatus.PENDING
					? { $min: { issuedAt: new Date() } }
					: {}),
			},
			{ returnDocument: "after", runValidators: true },
		);

		return { invoice };
	}

	// PAID transition — atomic with session
	const session = await mongoose.startSession();
	try {
		session.startTransaction();
		const now = new Date();

		// Atomically claim the PAID transition — prevents concurrent duplicate processing
		const invoice = await Invoice.findOneAndUpdate(
			{
				_id: id,
				paymentStatus: { $ne: InvoicePaymentStatus.PAID },
			},
			{
				paymentStatus: InvoicePaymentStatus.PAID,
				paidAt: now,
				...(paymentMethod ? { paymentMethod } : {}),
			},
			{ returnDocument: "after", session, runValidators: true },
		);

		if (!invoice) {
			await session.abortTransaction();
			return { invoice: null };
		}

		// Ensure issuedAt is set (for invoices going DRAFT → PAID directly)
		if (!invoice.issuedAt) {
			await Invoice.findByIdAndUpdate(id, { issuedAt: now }, { session });
		}

		// Convert linked lead
		let updatedLead = null;
		if (invoice.leadId) {
			updatedLead = await Lead.findByIdAndUpdate(
				invoice.leadId,
				{ status: LeadStatus.Converted },
				{ returnDocument: "after", session },
			);
		}

		// Activate membership from planSnapshot
		const snap = invoice.planSnapshot as {
			name: string;
			durationInDays: number;
			price: number;
			includedCredits: number;
		};

		const startDate = now;
		const endDate = new Date(now);
		endDate.setDate(endDate.getDate() + snap.durationInDays);

		const [membership] = await Membership.create(
			[
				{
					user: invoice.userId,
					planName: snap.name,
					creditsIncluded: snap.includedCredits,
					creditsRemaining: snap.includedCredits,
					status: MembershipStatus.Active,
					price: snap.price,
					currency: "INR",
					startDate,
					endDate,
				},
			],
			{ session },
		);

		await session.commitTransaction();
		return { invoice, lead: updatedLead, membership };
	} catch (error) {
		await session.abortTransaction();
		throw error;
	} finally {
		await session.endSession();
	}
};
