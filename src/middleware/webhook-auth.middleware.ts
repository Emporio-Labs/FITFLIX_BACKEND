import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const WEBHOOK_HEADER = "x-webhook-secret";

export const verifyWebhookSecret: RequestHandler = (req, res, next) => {
	const configuredSecret = process.env.WEBHOOK_SECRET?.trim();
	if (!configuredSecret) {
		res
			.status(503)
			.json({ message: "Webhook authentication is not configured" });
		return;
	}

	const providedSecret = req.header(WEBHOOK_HEADER)?.trim() ?? "";

	// Use timing-safe comparison to prevent secret enumeration via timing attacks.
	const expected = Buffer.from(configuredSecret, "utf8");
	const provided = Buffer.from(providedSecret, "utf8");
	const secretsMatch =
		provided.length === expected.length && timingSafeEqual(provided, expected);

	if (!secretsMatch) {
		res.status(401).json({ message: "Invalid webhook secret" });
		return;
	}

	next();
};
