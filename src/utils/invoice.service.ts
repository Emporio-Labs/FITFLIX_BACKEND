import mongoose from "mongoose";
import {
	type InvoicePaymentMethod,
	InvoicePaymentStatus,
	LeadStatus,
} from "../models/Enums";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import { logLeadActivity } from "../services/lead-activity.service";
import Location from "../models/Location";
import Membership from "../models/Membership";
import MembershipPlan from "../models/MembershipPlan";
import User from "../models/User";
import type {
	CreateInvoiceBody,
	ListInvoicesQuery,
} from "../validators/invoice.validator";
import { isEmailInUseAcrossSystem } from "./email-uniqueness";
import { generateInvoiceNumber } from "./invoice-number";
import { resolveTimeZone } from "./location.resolver";
import { formatDateInZone } from "./timezone.util";
import {
	assertNoMembershipOverlap,
	resolveMembershipTerm,
} from "./membership-term";

/** A refusal the invoice endpoints turn into `{ error, code }` with `status`. */
export class InvoiceSaleError extends Error {
	status: number;
	code: string;

	constructor(status: number, code: string, message: string) {
		super(message);
		this.name = "InvoiceSaleError";
		this.status = status;
		this.code = code;
	}
}

const lastTenDigits = (phone: string | null | undefined): string =>
	String(phone ?? "")
		.replace(/\D/g, "")
		.slice(-10);

const phoneMatch = (last10: string) => ({
	phone: { $regex: new RegExp(`${last10}$`) },
});

/**
 * The member account a lead buys under: the User whose phone matches the
 * lead's (last 10 digits), or a new one made from the lead. The lead is
 * linked via convertedUser; its status only becomes Converted on payment.
 *
 * A new account has no password — the app signs in by phone OTP, which finds
 * it by the same phone match. Unlike POST /leads/:id/convert this grants no
 * membership: the membership comes from paying the invoice.
 */
export const resolveLeadAccount = async (
	leadId: string | mongoose.Types.ObjectId,
	homeLocationId?: mongoose.Types.ObjectId | null,
): Promise<mongoose.Types.ObjectId> => {
	const lead = await Lead.findById(leadId);
	if (!lead) {
		throw new InvoiceSaleError(404, "NOT_FOUND", "Lead not found");
	}
	if (lead.convertedUser) {
		return lead.convertedUser;
	}

	const last10 = lastTenDigits(lead.phone);
	if (last10.length < 10) {
		throw new InvoiceSaleError(
			400,
			"BAD_REQUEST",
			"This lead has no phone number. Add one so the member can sign in to the app.",
		);
	}

	let user = await User.findOne(phoneMatch(last10)).select("_id");
	if (!user) {
		// An email already on another account would fail the unique index;
		// the phone is the identity here, so drop the email instead.
		const email = lead.email?.trim() || undefined;
		const emailTaken = email
			? (await isEmailInUseAcrossSystem(email)).exists
			: false;
		const homeBranch = homeLocationId ?? lead.locationId;

		try {
			// age/gender are unknown at the desk; the member fills them in
			// the app. Cast: the schema types still list them as required.
			user = await User.create({
				username: lead.leadName,
				phone: last10,
				...(email && !emailTaken ? { email } : {}),
				...(homeBranch ? { homeLocationId: homeBranch } : {}),
			} as unknown as Parameters<typeof User.create>[0]);
		} catch (error) {
			// Race: the same person was created by a parallel request.
			if ((error as { code?: number }).code !== 11000) throw error;
			user = await User.findOne(phoneMatch(last10)).select("_id");
			if (!user) throw error;
		}
	}

	await Lead.updateOne(
		{ _id: lead._id, convertedUser: null },
		{ $set: { convertedUser: user._id } },
	);
	return user._id;
};

/**
 * Who an invoice is raised to. Exactly one of the three inputs is used:
 * `userId` (an existing member), `leadId`, or `newLead` (a walk-in; reuses
 * the lead with the same phone, else creates one at the invoice branch).
 * Always returns an account, so paying the invoice never has to convert.
 */
export const resolveInvoicePerson = async (
	data: Pick<CreateInvoiceBody, "userId" | "leadId" | "newLead">,
	locationId?: mongoose.Types.ObjectId,
): Promise<{
	userId: mongoose.Types.ObjectId;
	leadId?: mongoose.Types.ObjectId;
}> => {
	if (data.userId) {
		const user = await User.findById(data.userId).select("_id");
		if (!user) {
			throw new InvoiceSaleError(404, "NOT_FOUND", "Member not found");
		}
		if (data.leadId) {
			await Lead.updateOne(
				{ _id: data.leadId, convertedUser: null },
				{ $set: { convertedUser: user._id } },
			);
		}
		return {
			userId: user._id,
			...(data.leadId
				? { leadId: new mongoose.Types.ObjectId(data.leadId) }
				: {}),
		};
	}

	let leadId = data.leadId ? new mongoose.Types.ObjectId(data.leadId) : null;

	if (!leadId && data.newLead) {
		const last10 = lastTenDigits(data.newLead.phone);
		const existing = await Lead.findOne(phoneMatch(last10))
			.sort({ createdAt: -1 })
			.select("_id");
		leadId =
			existing?._id ??
			(
				await Lead.create({
					leadName: data.newLead.name,
					phone: last10,
					email: data.newLead.email ?? "",
					source: "frontdesk-sale",
					...(locationId ? { locationId } : {}),
				})
			)._id;
	}

	if (!leadId) {
		throw new InvoiceSaleError(
			400,
			"BAD_REQUEST",
			"One of userId, leadId or newLead is required",
		);
	}

	return { userId: await resolveLeadAccount(leadId, locationId), leadId };
};

/** GST on the discounted amount at the branch's rate, to the paisa. */
export const computeInvoiceTax = async (
	subtotal: number,
	discount: number,
	locationId?: mongoose.Types.ObjectId,
): Promise<number> => {
	if (!locationId) return 0;
	const location = await Location.findById(locationId)
		.select("settings.taxRatePercent")
		.lean();
	const rate = Number(location?.settings?.taxRatePercent ?? 0);
	const taxable = Math.max(0, subtotal - discount);
	return Math.round(taxable * rate) / 100;
};

/** The invoice a previous POST with this Idempotency-Key created, if any. */
export const findInvoiceByIdempotencyKey = (
	createdById: string,
	idempotencyKey: string,
) =>
	mongoose.Types.ObjectId.isValid(createdById)
		? Invoice.findOne({
				createdBy: new mongoose.Types.ObjectId(createdById),
				idempotencyKey,
			})
		: null;

export const createInvoice = async (
	data: CreateInvoiceBody,
	createdById: string,
	locationId?: import("mongoose").Types.ObjectId,
	idempotencyKey?: string,
) => {
	if (data.planId) {
		const plan = await MembershipPlan.exists({ _id: data.planId });
		if (!plan) {
			throw new InvoiceSaleError(404, "NOT_FOUND", "Membership plan not found");
		}
	}

	const person = await resolveInvoicePerson(data, locationId);

	// Refuse up front rather than after the money is taken: the same check
	// runs again when the invoice is paid.
	if (data.startDate) {
		const term = resolveMembershipTerm({
			startDay: data.startDate,
			durationMonths: data.durationMonths,
			durationInDays: data.planSnapshot.durationInDays,
			timeZone: await resolveTimeZone({ locationId }),
		});
		await assertNoMembershipOverlap(
			person.userId,
			term.startDate,
			term.endDate,
		);
	}

	const invoiceNumber = await generateInvoiceNumber();

	const subtotal = data.items.reduce(
		(sum, item) => sum + item.price * item.quantity,
		0,
	);
	const tax =
		data.tax ?? (await computeInvoiceTax(subtotal, data.discount, locationId));
	const total = Math.max(0, subtotal + tax - data.discount);

	try {
		return await Invoice.create({
			invoiceNumber,
			userId: person.userId,
			...(person.leadId ? { leadId: person.leadId } : {}),
			items: data.items,
			subtotal,
			tax,
			discount: data.discount,
			total,
			planSnapshot: data.planSnapshot,
			...(data.planId
				? { planId: new mongoose.Types.ObjectId(data.planId) }
				: {}),
			...(data.startDate ? { startDate: data.startDate } : {}),
			...(data.durationMonths ? { durationMonths: data.durationMonths } : {}),
			...(data.discountReason ? { discountReason: data.discountReason } : {}),
			...(idempotencyKey ? { idempotencyKey } : {}),
			paymentStatus: data.paymentStatus as InvoicePaymentStatus,
			paymentMethod: data.paymentMethod as InvoicePaymentMethod,
			...(data.issuedAt ? { issuedAt: new Date(data.issuedAt) } : {}),
			createdBy: new mongoose.Types.ObjectId(createdById),
			...(locationId ? { locationId } : {}),
		});
	} catch (error) {
		// A concurrent retry with the same key won the insert; hand back its invoice.
		const isKeyRace =
			idempotencyKey &&
			(error as { code?: number; keyPattern?: Record<string, unknown> })
				.code === 11000 &&
			(error as { keyPattern?: Record<string, unknown> }).keyPattern
				?.idempotencyKey;
		if (isKeyRace) {
			const existing = await findInvoiceByIdempotencyKey(
				createdById,
				idempotencyKey,
			);
			if (existing) return existing;
		}
		throw error;
	}
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
	return Invoice.findById(id).populate<{
		userId: { username: string; email: string; phone?: string };
	}>("userId", "username email phone");
};

export const transitionInvoiceStatus = async (
	id: string,
	newStatus: InvoicePaymentStatus,
	paymentMethod?: InvoicePaymentMethod,
	options: {
		/** UPI transaction id, card slip number, etc. */
		paymentReference?: string;
		/** Staff member recording the payment. */
		recordedBy?: string;
		/**
		 * Overrides the invoice's startDate for the membership a PAID invoice
		 * creates (kept from #135; new sales set startDate on the invoice).
		 */
		membershipStartDate?: Date;
	} = {},
): Promise<{
	invoice: unknown;
	lead?: unknown;
	membership?: unknown;
}> => {
	const paymentFields = {
		...(paymentMethod ? { paymentMethod } : {}),
		...(options.paymentReference
			? { paymentReference: options.paymentReference }
			: {}),
	};

	if (newStatus !== InvoicePaymentStatus.PAID) {
		const invoice = await Invoice.findOneAndUpdate(
			{ _id: id },
			{
				paymentStatus: newStatus,
				...paymentFields,
				// $min sets issuedAt to now only when the field is unset (missing field gets the value; existing earlier date is preserved)
				...(newStatus === InvoicePaymentStatus.PENDING
					? { $min: { issuedAt: new Date() } }
					: {}),
			},
			{ returnDocument: "after", runValidators: true },
		);

		return { invoice };
	}

	// Invoices raised before accounts were resolved at creation may still
	// have only a lead. Resolve (or create) the account now, outside the
	// transaction, so paying never has to wait on a manual convert.
	const pending = await Invoice.findById(id).select(
		"userId leadId locationId paymentStatus",
	);
	if (pending && !pending.userId && pending.leadId) {
		const userId = await resolveLeadAccount(pending.leadId, pending.locationId);
		await Invoice.updateOne({ _id: id, userId: null }, { $set: { userId } });
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
				...paymentFields,
				...(options.recordedBy &&
				mongoose.Types.ObjectId.isValid(options.recordedBy)
					? { recordedBy: new mongoose.Types.ObjectId(options.recordedBy) }
					: {}),
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

		const membershipUserId = invoice.userId;
		if (!membershipUserId) {
			throw new InvoiceSaleError(
				409,
				"CONFLICT",
				"Cannot activate membership: no member or lead is linked to this invoice.",
			);
		}

		// Convert linked lead
		let updatedLead = null;
		if (invoice.leadId) {
			updatedLead = await Lead.findByIdAndUpdate(
				invoice.leadId,
				{ status: LeadStatus.Converted, convertedUser: membershipUserId },
				{ returnDocument: "after", session },
			);
		}

		// Build the membership from the sale on the invoice.
		const snap = invoice.planSnapshot as {
			name: string;
			durationInDays: number;
			price: number;
			includedCredits: number;
		};

		const timeZone = await resolveTimeZone({
			locationId: invoice.locationId,
			userId: membershipUserId,
		});
		// A presale can be paid well before the branch opens; the membership
		// then starts on the chosen day instead of the payment date.
		const term = resolveMembershipTerm({
			startDay: options.membershipStartDate
				? formatDateInZone(options.membershipStartDate, timeZone)
				: invoice.startDate,
			durationMonths: invoice.durationMonths,
			durationInDays: snap.durationInDays,
			timeZone,
			now,
		});

		await assertNoMembershipOverlap(
			membershipUserId,
			term.startDate,
			term.endDate,
			session,
		);

		const [membership] = await Membership.create(
			[
				{
					user: membershipUserId,
					planName: snap.name,
					creditsIncluded: snap.includedCredits,
					creditsRemaining: snap.includedCredits,
					status: term.status,
					price: snap.price,
					currency: "INR",
					startDate: term.startDate,
					endDate: term.endDate,
					planId: invoice.planId ?? null,
					invoiceId: invoice._id,
					// Issued where the invoice was; without one the location-stamp
					// plugin falls back to the member's home branch.
					...(invoice.locationId ? { locationId: invoice.locationId } : {}),
				},
			],
			{ session },
		);

		await session.commitTransaction();
		if (updatedLead) {
			void logLeadActivity({
				leadId: updatedLead._id,
				locationId: updatedLead.locationId,
				type: "system",
				outcome: "converted",
				label: "Paid — joined as a member",
				statusTo: LeadStatus.Converted,
			});
		}
		return { invoice, lead: updatedLead, membership };
	} catch (error) {
		if (session.inTransaction()) {
			await session.abortTransaction();
		}
		throw error;
	} finally {
		await session.endSession();
	}
};
