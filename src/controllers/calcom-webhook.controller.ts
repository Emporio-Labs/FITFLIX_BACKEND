import type { Request, RequestHandler, Response } from "express";
import {
	handleCalcomWebhook,
	verifyCalcomSignature,
} from "../integrations/calcom/calcom.webhook";
import type { CalcomWebhookPayload } from "../integrations/calcom/calcom.types";

export const handleCalcomWebhookRequest: RequestHandler = async (
	req: Request & { rawBody?: Buffer },
	res: Response,
	next,
) => {
	// 1. Signature verification — Cal.com sends X-Cal-Signature-256
	const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
	const signature = req.headers["x-cal-signature-256"] as string | undefined;

	if (!verifyCalcomSignature(rawBody, signature)) {
		res.status(401).json({ error: "Invalid webhook signature", code: "UNAUTHORIZED" });
		return;
	}

	const payload = req.body as CalcomWebhookPayload;

	if (!payload?.triggerEvent || !payload?.payload) {
		res.status(400).json({ error: "Invalid webhook payload", code: "BAD_REQUEST" });
		return;
	}

	// 2. Delivery UID — Cal.com includes a unique uid per delivery at payload root
	// Fall back to a composite if missing (defensive)
	const deliveryId =
		payload.uid ??
		`${payload.triggerEvent}::${payload.payload.uid}::${payload.createdAt}`;

	try {
		await handleCalcomWebhook(payload, deliveryId);
		res.status(200).json({ received: true });
	} catch (err) {
		// Return 5xx so Cal.com retries (unless the handler moved event to DLQ)
		console.error("[calcom-webhook] Handler error", err);
		res.status(500).json({ error: "Webhook processing failed", code: "INTERNAL_ERROR" });
	}
};
