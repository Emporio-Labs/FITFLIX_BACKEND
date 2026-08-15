import crypto from "node:crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import {
	CreditTransactionSource,
	CreditTransactionType,
	InvoicePaymentMethod,
	InvoicePaymentStatus,
	LeadStatus,
	MembershipStatus,
	WebhookEventStatus,
} from "../models/Enums";
import CreditTransaction from "../models/CreditTransaction";
import Invoice from "../models/Invoice";
import Lead from "../models/Lead";
import Membership from "../models/Membership";
import MembershipPlan from "../models/MembershipPlan";
import WebhookEvent from "../models/WebhookEvent";
import User from "../models/User";
import { generateInvoiceNumber } from "../utils/invoice-number";
import { buildActiveMembershipFilterWith } from "../utils/membership-status.util";

/**
 * A brand-new PT membership should inherit whatever trainer the admin already
 * assigned via the "Assigned Personal Trainer" screen. Without this, every
 * purchase or renewal creates a package the member app treats as unassigned,
 * reopening the full trainer picker instead of locking to their coach.
 */
const getInheritedTrainerId = async (
	userId: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId | null> => {
	const user = await User.findById(userId).select("assignedTrainer");
	return user?.assignedTrainer ?? null;
};
import {
	computeNewEndDate,
	computeRenewalEndDate,
} from "../utils/membership-duration.util";
import { executeInTransaction } from "../utils/transaction.util";

export const getRazorpayClient = (): Razorpay | null => {
	const keyId = process.env.RAZORPAY_KEY_ID?.trim();
	const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

	if (!keyId || !keySecret) {
		return null;
	}

	return new Razorpay({
		key_id: keyId,
		key_secret: keySecret,
	});
};

export const getBillingConfig = () => {
	const keyId = process.env.RAZORPAY_KEY_ID?.trim() || null;
	const isOnlineEnabled = Boolean(keyId && process.env.RAZORPAY_KEY_SECRET?.trim());

	return {
		onlinePaymentsEnabled: isOnlineEnabled,
		keyId: isOnlineEnabled ? keyId : null,
		gateway: "RAZORPAY",
		currency: "INR",
		taxRatePercent: 18,
		fallbackMessage:
			"Online payments are currently offline / in setup mode. Please request a callback or pay at the club frontdesk.",
		supportPhone: process.env.SUPPORT_PHONE || "+91 91234 56789",
		clubLocation: "Fitflix Wellness Club, Sainikpuri, Hyderabad",
	};
};

export const createPaymentOrder = async (
	userId: string,
	planId: string,
	isEarlyRenewal = false,
) => {
	const plan = await MembershipPlan.findById(planId);
	if (!plan || !plan.active) {
		throw new Error("Selected plan is not available or inactive.");
	}

	const basePrice = plan.price;
	const taxPercent = plan.taxRatePercent || 18;
	const taxAmount = Math.round(basePrice * (taxPercent / 100));
	const grandTotal = basePrice + taxAmount;
	const amountInPaise = grandTotal * 100;

	const razorpay = getRazorpayClient();
	if (!razorpay) {
		return {
			onlineEnabled: false,
			plan: {
				id: plan._id.toString(),
				name: plan.name,
				category: plan.category,
				basePrice,
				taxAmount,
				grandTotal,
				ptSessionsIncluded: plan.ptSessionsIncluded,
				durationDays: plan.durationDays || 30,
			},
			message: "Online payment gateway is not configured. Please use fallback booking.",
		};
	}

	const orderReceipt = `rcpt_${Date.now().toString().slice(-8)}`;
	const rzpOrder = await razorpay.orders.create({
		amount: amountInPaise,
		currency: plan.currency || "INR",
		receipt: orderReceipt,
		notes: {
			userId,
			planId: plan._id.toString(),
			isEarlyRenewal: String(isEarlyRenewal),
		},
	});

	return {
		onlineEnabled: true,
		orderId: rzpOrder.id,
		amount: grandTotal,
		amountInPaise,
		currency: plan.currency || "INR",
		keyId: process.env.RAZORPAY_KEY_ID,
		plan: {
			id: plan._id.toString(),
			name: plan.name,
			category: plan.category,
			basePrice,
			taxAmount,
			grandTotal,
			ptSessionsIncluded: plan.ptSessionsIncluded,
			durationDays: plan.durationDays || 30,
		},
	};
};

export const verifyAndProvisionPayment = async (params: {
	userId: string;
	planId: string;
	razorpayOrderId: string;
	razorpayPaymentId: string;
	razorpaySignature: string;
	isEarlyRenewal?: boolean;
	eventId?: string;
}) => {
	const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
	if (!secret) {
		throw new Error("Razorpay secret not configured on server.");
	}

	// 1. Signature Verification
	const expectedSignature = crypto
		.createHmac("sha256", secret)
		.update(`${params.razorpayOrderId}|${params.razorpayPaymentId}`)
		.digest("hex");

	if (expectedSignature !== params.razorpaySignature) {
		throw new Error("Invalid Razorpay payment signature.");
	}

	const userObjId = new mongoose.Types.ObjectId(params.userId);
	const plan = await MembershipPlan.findById(params.planId);
	if (!plan) {
		throw new Error("Plan not found");
	}

	const eventId = params.eventId || params.razorpayPaymentId;

	return executeInTransaction(async (session) => {
		// 2. Webhook Idempotency & Deduplication Check
		const existingEvent = await WebhookEvent.findOne({ eventId }).session(session);
		if (existingEvent) {
			console.info(`[BILLING_IDEMPOTENCY] Event ${eventId} already processed.`);
			return { status: "ignored_duplicate", eventId };
		}

		await WebhookEvent.create(
			[
				{
					provider: "razorpay",
					eventId,
					triggerEvent: "payment.captured",
					payload: params,
					status: WebhookEventStatus.Processed,
					receivedAt: new Date(),
					processedAt: new Date(),
				},
			],
			{ session },
		);

		// 3. Generate Sequential GST Invoice (FF-INV-YYYY-XXXXX)
		const invoiceNumber = await generateInvoiceNumber(session);
		const basePrice = plan.price;
		const taxAmount = Math.round(basePrice * ((plan.taxRatePercent || 18) / 100));
		const grandTotal = basePrice + taxAmount;

		const invoice = await Invoice.create(
			[
				{
					invoiceNumber,
					userId: userObjId,
					items: [
						{
							name: plan.name,
							price: basePrice,
							quantity: 1,
						},
					],
					subtotal: basePrice,
					tax: taxAmount,
					discount: 0,
					total: grandTotal,
					planSnapshot: {
						name: plan.name,
						durationInDays: plan.durationDays || 30,
						price: basePrice,
						includedCredits: plan.creditsIncluded || 0,
					},
					paymentStatus: InvoicePaymentStatus.PAID,
					paymentMethod: InvoicePaymentMethod.RAZORPAY,
					issuedAt: new Date(),
					paidAt: new Date(),
				},
			],
			{ session },
		);

		// 4. Provision or Extend Membership / PT Quota
		const now = new Date();
		const endDate = computeNewEndDate(plan, now);

		const isPT = plan.category === "PERSONAL_TRAINING" || (plan.ptSessionsIncluded || 0) > 0;
		const ptQuota = plan.ptSessionsIncluded || 0;

		let membership: any;

		if (params.isEarlyRenewal) {
			// Early top up / renewal: add sessions to the active membership and
			// EXTEND the term from its existing expiry. Setting endDate to
			// `now + term` here used to destroy any unused days the member had
			// left — the whole point of renewing early.
			const existing = await Membership.findOne(
				buildActiveMembershipFilterWith(userObjId, [
					{ category: plan.category || "PERSONAL_TRAINING" },
				]),
			).session(session);

			if (existing) {
				membership = await Membership.findOneAndUpdate(
					{ _id: existing._id },
					{
						$inc: {
							ptSessionsIncluded: ptQuota,
							ptSessionsRemaining: ptQuota,
						},
						$set: {
							endDate: computeRenewalEndDate(plan, existing.endDate, now),
						},
					},
					{ new: true, session },
				);
			}
		}

		if (!membership) {
			const inheritedTrainerId = isPT
				? await getInheritedTrainerId(userObjId)
				: null;

			membership = await Membership.create(
				[
					{
						user: userObjId,
						planName: plan.name,
						category: plan.category || "PERSONAL_TRAINING",
						creditsIncluded: plan.creditsIncluded || 0,
						creditsRemaining: plan.creditsIncluded || 0,
						ptSessionsIncluded: isPT ? ptQuota : 0,
						ptSessionsRemaining: isPT ? ptQuota : 0,
						ptSessionsUsed: 0,
						status: MembershipStatus.Active,
						price: grandTotal,
						currency: plan.currency || "INR",
						startDate: now,
						endDate,
						features: plan.features || [],
						assignedTrainerId: inheritedTrainerId,
					},
				],
				{ session },
			);
			membership = membership[0];
		}

		// 5. Audit Credit Ledger
		if (isPT && ptQuota > 0) {
			await CreditTransaction.create(
				[
					{
						user: userObjId,
						membership: membership._id,
						amount: ptQuota,
						type: CreditTransactionType.AdminTopUp,
						sourceType: CreditTransactionSource.PersonalTraining,
						sourceId: invoice[0]._id,
						actorRole: "system",
						reason: `Provisioned ${ptQuota} PT Sessions via Invoice ${invoiceNumber}`,
					},
				],
				{ session },
			);
		}

		return {
			success: true,
			invoiceNumber,
			membership,
			invoice: invoice[0],
		};
	});
};

export const purchasePlanWithCredits = async (params: {
	userId: string;
	planId: string;
	creditsToDeduct?: number;
}) => {
	const userObjId = new mongoose.Types.ObjectId(params.userId);
	const planObjId = new mongoose.Types.ObjectId(params.planId);

	return executeInTransaction(async (session) => {
		const plan = await MembershipPlan.findById(planObjId).session(session);
		if (!plan) throw new Error("Membership plan not found");

		const requiredCredits = params.creditsToDeduct || plan.creditsIncluded || (plan.price ? Math.ceil(plan.price / 100) : 10);

		// Find user's active membership with remaining credits. Expiry-guarded:
		// a bare `status: Active` check here let an expired wallet fund a new
		// purchase, because nothing flips status until the expiry job runs.
		const generalMembership = await Membership.findOne(
			buildActiveMembershipFilterWith(userObjId, [
				{ creditsRemaining: { $gte: requiredCredits } },
			]),
		).session(session);

		if (!generalMembership) {
			throw new Error(`Insufficient wallet credits. Required: ${requiredCredits} credits.`);
		}

		// 1. Deduct credits
		await Membership.findByIdAndUpdate(
			generalMembership._id,
			{ $inc: { creditsRemaining: -requiredCredits } },
			{ session },
		);

		// 2. Generate invoice
		const invoiceNumber = await getNextInvoiceNumber(session);
		const now = new Date();
		const isPT = plan.category === "PERSONAL_TRAINING" || (plan.ptSessionsIncluded && plan.ptSessionsIncluded > 0);
		const ptQuota = plan.ptSessionsIncluded || 14;
		// Term comes from the plan. This used to be pinned to the last day of
		// the current calendar month regardless of what was sold, so a package
		// bought on the 28th expired in three days.
		const endDate = computeNewEndDate(plan, now);

		const invoice = await Invoice.create(
			[
				{
					userId: userObjId,
					invoiceNumber,
					items: [
						{
							itemType: "MEMBERSHIP",
							itemId: plan._id,
							description: `${plan.name} (${requiredCredits} Credits)`,
							quantity: 1,
							unitPrice: plan.price || 0,
							taxRate: 0,
							taxAmount: 0,
							totalAmount: plan.price || 0,
						},
					],
					subTotal: plan.price || 0,
					taxTotal: 0,
					grandTotal: plan.price || 0,
					paymentMethod: InvoicePaymentMethod.POS_CARD,
					paymentStatus: "PAID",
					paidAt: now,
					notes: `Purchased with ${requiredCredits} in-app credits.`,
				},
			],
			{ session },
		);

		// 3. Provision PT membership. Extend from the member's existing expiry
		// rather than overwriting it, so topping up never shortens a term.
		const existingPt = await Membership.findOne(
			buildActiveMembershipFilterWith(userObjId, [
				{ category: "PERSONAL_TRAINING" },
			]),
		).session(session);

		let ptMembership = existingPt
			? await Membership.findOneAndUpdate(
					{ _id: existingPt._id },
					{
						$inc: {
							ptSessionsIncluded: ptQuota,
							ptSessionsRemaining: ptQuota,
						},
						$set: {
							endDate: computeRenewalEndDate(plan, existingPt.endDate, now),
						},
					},
					{ new: true, session },
				)
			: null;

		if (!ptMembership) {
			const inheritedTrainerId = await getInheritedTrainerId(userObjId);

			const created = await Membership.create(
				[
					{
						user: userObjId,
						planName: plan.name,
						category: "PERSONAL_TRAINING",
						creditsIncluded: 0,
						creditsRemaining: 0,
						ptSessionsIncluded: ptQuota,
						ptSessionsRemaining: ptQuota,
						ptSessionsUsed: 0,
						status: MembershipStatus.Active,
						price: plan.price || 0,
						currency: "INR",
						startDate: now,
						endDate,
						features: plan.features || [],
						assignedTrainerId: inheritedTrainerId,
					},
				],
				{ session },
			);
			ptMembership = created[0];
		}

		// 4. Log transactions
		await CreditTransaction.create(
			[
				{
					user: userObjId,
					membership: generalMembership._id,
					amount: -requiredCredits,
					type: CreditTransactionType.Usage,
					sourceType: CreditTransactionSource.PersonalTraining,
					sourceId: invoice[0]._id,
					actorRole: "member",
					reason: `Exchanged ${requiredCredits} credits for ${plan.name}`,
				},
				{
					user: userObjId,
					membership: ptMembership._id,
					amount: ptQuota,
					type: CreditTransactionType.AdminTopUp,
					sourceType: CreditTransactionSource.PersonalTraining,
					sourceId: invoice[0]._id,
					actorRole: "system",
					reason: `Provisioned ${ptQuota} PT Sessions via Credit Exchange`,
				},
			],
			{ session },
		);

		return {
			success: true,
			invoiceNumber,
			ptMembership,
			deductedCredits: requiredCredits,
		};
	});
};

export const createCallbackInquiry = async (params: {
	userId?: string;
	memberName: string;
	phone: string;
	email?: string;
	planId?: string;
	planName?: string;
	notes?: string;
}) => {
	const now = new Date();
	const slaDeadline = new Date(now.getTime() + 15 * 60 * 1000); // 15-minute SLA

	const lead = await Lead.create({
		leadName: params.memberName,
		phone: params.phone,
		email: params.email || "",
		status: LeadStatus.New,
		notes: `[APP_PURCHASE_FALLBACK] Inquiring about plan: ${params.planName || "Personal Training"}. ${params.notes || ""}`,
		source: "APP_PAYMENT_FALLBACK",
		slaDeadline,
		isEscalated: false,
		convertedUser: params.userId ? new mongoose.Types.ObjectId(params.userId) : null,
	});

	return lead;
};
