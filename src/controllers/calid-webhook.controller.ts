import type { Request, RequestHandler, Response } from "express";
import {
	handleCalIdWebhook,
	verifyCalIdSignature,
} from "../integrations/calid/calid.webhook";
import type { CalIdWebhookPayload } from "../integrations/calid/calid.types";

export const handleCalIdWebhookRequest: RequestHandler = async (
	req: Request & { rawBody?: Buffer },
	res: Response,
	_next,
) => {
	// 1. Signature verification — Cal ID sends X-Cal-Signature-256
	const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
	const signature = req.headers["x-cal-signature-256"] as string | undefined;

	if (!verifyCalIdSignature(rawBody, signature)) {
		res.status(401).json({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
		return;
	}

	const payload = req.body as CalIdWebhookPayload;

	if (!payload?.triggerEvent || !payload?.payload) {
		res.status(400).json({ error: "Invalid webhook payload", code: "BAD_REQUEST" });
		return;
	}

	const deliveryId =
		payload.uid ??
		`${payload.triggerEvent}::${payload.payload.uid}::${payload.createdAt}`;

	try {
		await handleCalIdWebhook(payload, deliveryId);
		res.status(200).json({ received: true });
	} catch (err) {
		console.error("[calid-webhook] Handler error", err);
		res.status(500).json({ error: "Webhook processing failed", code: "INTERNAL_ERROR" });
	}
};
