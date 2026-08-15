import type { RequestHandler } from "express";
import crypto from "node:crypto";
import {
	createCallbackInquiry,
	createPaymentOrder,
	getBillingConfig,
	purchasePlanWithCredits,
	verifyAndProvisionPayment,
} from "../services/billing-provisioning.service";

export const getBillingConfigHandler: RequestHandler = (_req, res) => {
	const config = getBillingConfig();
	res.status(200).json({ config });
};

export const purchaseWithCreditsHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { planId, creditsToDeduct } = req.body;
		if (!planId) {
			res.status(400).json({ message: "planId is required" });
			return;
		}

		const result = await purchasePlanWithCredits({
			userId: user.id,
			planId,
			creditsToDeduct: creditsToDeduct ? Number(creditsToDeduct) : undefined,
		});

		res.status(200).json({
			message: "PT Package purchased and activated with credits successfully",
			result,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to purchase plan with credits" });
	}
};

export const createOrderHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const { planId, isEarlyRenewal } = req.body;
		if (!planId) {
			res.status(400).json({ message: "planId is required" });
			return;
		}

		const result = await createPaymentOrder(
			user.id,
			planId,
			Boolean(isEarlyRenewal),
		);
		res.status(200).json(result);
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to create order" });
	}
};

export const verifyPaymentHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user;
		if (!user?.id) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const {
			planId,
			razorpayOrderId,
			razorpayPaymentId,
			razorpaySignature,
			isEarlyRenewal,
		} = req.body;

		if (!planId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
			res.status(400).json({
				message:
					"planId, razorpayOrderId, razorpayPaymentId, and razorpaySignature are required",
			});
			return;
		}

		const result = await verifyAndProvisionPayment({
			userId: user.id,
			planId,
			razorpayOrderId,
			razorpayPaymentId,
			razorpaySignature,
			isEarlyRenewal: Boolean(isEarlyRenewal),
		});

		res.status(200).json({
			message: "Payment verified and PT package provisioned successfully",
			result,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Payment verification failed" });
	}
};

export const createCallbackInquiryHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const user = req.user;
		const { memberName, phone, email, planId, planName, notes } = req.body;

		if (!memberName || !phone) {
			res.status(400).json({ message: "memberName and phone are required" });
			return;
		}

		const lead = await createCallbackInquiry({
			userId: user?.id,
			memberName,
			phone,
			email,
			planId,
			planName,
			notes,
		});

		res.status(201).json({
			message:
				"Callback request received! Our frontdesk concierge will contact you within 15 minutes.",
			lead,
		});
	} catch (error: any) {
		res.status(400).json({ message: error.message || "Failed to create inquiry" });
	}
};

export const razorpayWebhookHandler: RequestHandler = async (req, res) => {
	try {
		const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
		if (webhookSecret) {
			const signature = req.headers["x-razorpay-signature"] as string;
			const body = JSON.stringify(req.body);
			const expectedSignature = crypto
				.createHmac("sha256", webhookSecret)
				.update(body)
				.digest("hex");

			if (signature !== expectedSignature) {
				console.warn("[WEBHOOK] Invalid Razorpay webhook signature");
				res.status(400).json({ status: "invalid_signature" });
				return;
			}
		}

		const event = req.body.event;
		const payload = req.body.payload;

		console.info(`[WEBHOOK_RECEIVED] Razorpay event: ${event}`);

		if (event === "payment.captured" || event === "order.paid") {
			const notes = payload?.payment?.entity?.notes || {};
			if (notes.userId && notes.planId) {
				await verifyAndProvisionPayment({
					userId: notes.userId,
					planId: notes.planId,
					razorpayOrderId: payload.payment.entity.order_id,
					razorpayPaymentId: payload.payment.entity.id,
					razorpaySignature: "WEBHOOK_VERIFIED",
					isEarlyRenewal: notes.isEarlyRenewal === "true",
					eventId: req.headers["x-razorpay-event-id"] as string || payload.payment.entity.id,
				});
			}
		}

		res.status(200).json({ status: "ok" });
	} catch (error) {
		console.error("[RAZORPAY_WEBHOOK_ERROR]", error);
		res.status(200).json({ status: "error_logged" });
	}
};
