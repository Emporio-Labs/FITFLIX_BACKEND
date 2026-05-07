import type { RequestHandler } from "express";

const WEBHOOK_HEADER = "x-webhook-secret";

export const verifyWebhookSecret: RequestHandler = (req, res, next) => {
	const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
	if (!configuredSecret) {
		res.status(503).json({ message: "Webhook authentication is not configured" });
		return;
	}

	const providedSecret = req.header(WEBHOOK_HEADER)?.trim();
	if (!providedSecret || providedSecret !== configuredSecret) {
		res.status(401).json({ message: "Invalid webhook secret" });
		return;
	}

	next();
};
