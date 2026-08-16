import { type Request, type Response, Router } from "express";
import { processReminders } from "../services/reminder.service";
import { processLeadFollowups } from "../services/lead-followup.scheduler";
import {
	expireDueRooms,
	prepareDueRooms,
	verifyHostPresence,
} from "../services/session-room-lifecycle.service";

const router = Router();

// Guard: only allow requests with the correct internal secret
function verifyInternalSecret(req: Request, res: Response): boolean {
	const secret = process.env.REMINDER_TICK_SECRET;
	if (!secret) {
		// If no secret configured, reject all calls
		res.status(503).json({
			error: "Internal routes not configured",
			code: "NOT_CONFIGURED",
		});
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
		res
			.status(500)
			.json({ error: "Reminder processing failed", code: "INTERNAL_ERROR" });
	}
});

/**
 * POST /internal/sessions/lifecycle/tick
 * Called every minute by an external scheduler (the Vercel Cron entry only
 * runs daily, too coarse for a T-minus-lead / T-plus-expiry room lifecycle).
 *
 * Three independent sweeps, for both group_class and live_stream sessions:
 *  - prepareDueRooms:    stamp videoRoomId + roomStatus READY at (start - lead)
 *  - verifyHostPresence: self-heal hostLiveAt against Zego's room membership,
 *                        for a host whose client never called host-presence
 *  - expireDueRooms:     kick everyone, flip roomStatus EXPIRED + status
 *                        COMPLETED at (end + grace)
 *
 * All three are pure side-effect sweeps — join/deny gating in
 * resolveSessionAccess is arithmetic (plus the hostLiveAt read, which the
 * host's own client already writes on the fast path) and does not depend on
 * this route ever running, so a missed tick degrades to stale-looking room
 * state, not a wrongly admitted or wrongly refused join.
 */
router.post("/sessions/lifecycle/tick", async (req: Request, res: Response) => {
	if (!verifyInternalSecret(req, res)) return;

	try {
		const now = new Date();
		const [prepared, hostPresence, expired] = await Promise.all([
			prepareDueRooms(now),
			verifyHostPresence(now),
			expireDueRooms(now),
		]);
		res.status(200).json({ ok: true, prepared, hostPresence, expired });
	} catch (err) {
		console.error("[internal/sessions/lifecycle/tick] Error", err);
		res
			.status(500)
			.json({ error: "Session lifecycle tick failed", code: "INTERNAL_ERROR" });
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

/**
 * POST /internal/sessions/materialize/tick
 * Periodic job to roll forward session materialization for recurring classes.
 */
router.post("/sessions/materialize/tick", async (req: Request, res: Response) => {
	if (!verifyInternalSecret(req, res)) return;

	try {
		const { ensureSessionsMaterializedForActiveClasses } = await import(
			"../controllers/class-schedule.controller"
		);
		await ensureSessionsMaterializedForActiveClasses();
		res.status(200).json({ ok: true, message: "Recurring sessions materialized" });
	} catch (err) {
		console.error("[internal/sessions/materialize/tick] Error", err);
		res
			.status(500)
			.json({ error: "Session materialization failed", code: "INTERNAL_ERROR" });
	}
});

export default router;
