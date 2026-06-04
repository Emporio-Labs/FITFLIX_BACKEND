import { Router, type Request, type Response } from "express";
import { processReminders } from "../services/reminder.service";
import { processLeadFollowups } from "../services/lead-followup.scheduler";

const router = Router();

// Guard: only allow requests with the correct internal secret
function verifyInternalSecret(req: Request, res: Response): boolean {
	const secret = process.env.REMINDER_TICK_SECRET;
	if (!secret) {
		// If no secret configured, reject all calls
		res.status(503).json({ error: "Internal routes not configured", code: "NOT_CONFIGURED" });
		return false;
	}

	const provided =
		(req.headers["x-internal-secret"] as string | undefined) ??
		(req.headers["x-webhook-secret"] as string | undefined);

	if (provided !== secret) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return false;
	}

	return true;
}

/**
 * POST /internal/reminders/tick
 * Called by Vercel Cron or any scheduler every minute.
 * Processes all due appointment reminders atomically.
 */
router.post("/reminders/tick", async (req: Request, res: Response) => {
	if (!verifyInternalSecret(req, res)) return;

	try {
		const result = await processReminders();
		res.status(200).json({ ok: true, ...result });
	} catch (err) {
		console.error("[internal/reminders/tick] Error", err);
		res.status(500).json({ error: "Reminder processing failed", code: "INTERNAL_ERROR" });
	}
});

/**
 * POST /internal/leads/followup
 * Called by Vercel Cron or any scheduler to trigger lead follow-ups.
 */
router.post("/leads/followup", async (req: Request, res: Response) => {
	if (!verifyInternalSecret(req, res)) return;

	try {
		const result = await processLeadFollowups();
		res.status(200).json({ ok: true, ...result });
	} catch (err) {
		console.error("[internal/leads/followup] Error", err);
		res.status(500).json({ error: "Lead follow-up processing failed", code: "INTERNAL_ERROR" });
	}
});

export default router;
