import { Router, type Request, type Response, type NextFunction } from "express";
import { handleCalIdWebhookRequest } from "../controllers/calid-webhook.controller";

const router = Router();

// Capture raw body before JSON parsing so we can verify the HMAC signature.
// This middleware runs before express.json() on this route only.
router.use((req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
	const chunks: Buffer[] = [];
	req.on("data", (chunk: Buffer) => chunks.push(chunk));
	req.on("end", () => {
		req.rawBody = Buffer.concat(chunks);
		try {
			req.body = JSON.parse(req.rawBody.toString("utf-8")) as unknown;
		} catch {
			req.body = {};
		}
		next();
	});
	req.on("error", next);
});

router.post("/", handleCalIdWebhookRequest);

export default router;
