import { type Request, type Response, Router } from "express";
import type { Types } from "mongoose";
import User from "../models/User";
import { processReminders } from "../services/reminder.service";
import { processLeadFollowups } from "../services/lead-followup.scheduler";
import {
	expireDueRooms,
	prepareDueRooms,
	verifyHostPresence,
} from "../services/session-room-lifecycle.service";
import {
	type ActiveXRecord,
	upsertBcaRecordForUser,
} from "../utils/activex.service";

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

// Guard: only allow the ActiveX vendor's own credential — deliberately a
// separate secret from `REMINDER_TICK_SECRET` above, so rotating one never
// affects the other, and so this one credential can be handed to a
// third-party integration without also exposing the cron-tick secret.
function verifyActiveXIngestSecret(req: Request, res: Response): boolean {
	const secret = process.env.ACTIVEX_INGEST_SECRET;
	if (!secret) {
		res.status(503).json({
			error: "ActiveX ingest is not configured",
			code: "NOT_CONFIGURED",
		});
		return false;
	}

	const provided = req.headers["x-activex-ingest-secret"] as
		| string
		| undefined;

	if (provided !== secret) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return false;
	}

	return true;
}

type BcaIngestResult =
	| { status: "synced"; phone: string; userId: string }
	| { status: "no_match"; phone: string }
	| { status: "invalid"; reason: string };

/**
 * POST /internal/bca/ingest
 * Called by the ActiveX machine (or its vendor cloud) when a member
 * completes a body-composition scan, pushing results in instead of waiting
 * for the member to open the app and tap sync.
 *
 * Body: `{ records: ActiveXRecord[] }` — each record is the same raw shape
 * ActiveX's own pull API returns in `result.records[]` (must carry a
 * `phone` field), so `upsertBcaRecordForUser` handles both ingest paths
 * identically. ASSUMPTION (unconfirmed with the vendor): that the machine or
 * its cloud can be configured to POST this shape to an arbitrary URL with a
 * static secret header — if ActiveX only offers pull, this route can stay
 * unused and a scheduled `/internal/*` tick calling `fetchBcaRecords` per
 * active member is the fallback.
 *
 * A phone matching no member is reported per-record as "no_match" rather
 * than failing the whole batch — one scan station serves many members
 * back-to-back, and one unrecognised number should not drop the rest.
 */
router.post("/bca/ingest", async (req: Request, res: Response) => {
	if (!verifyActiveXIngestSecret(req, res)) return;

	const records: ActiveXRecord[] | null = Array.isArray(req.body?.records)
		? req.body.records
		: null;

	if (!records) {
		res.status(400).json({
			error: "Body must be { records: ActiveXRecord[] }",
			code: "VALIDATION_ERROR",
		});
		return;
	}

	const receivedAt = new Date();
	const results: BcaIngestResult[] = [];

	for (const record of records) {
		const rawRecord = record as Record<string, unknown>;
		const rawPhone =
			typeof rawRecord?.phone === "string" ? rawRecord.phone : "";
		const last10 = rawPhone.replace(/\D/g, "").slice(-10);

		if (last10.length < 10) {
			results.push({
				status: "invalid",
				reason: "Record is missing a valid phone number",
			});
			continue;
		}

		try {
			const user = await User.findOne({
				phone: { $regex: new RegExp(`${last10}$`) },
			}).select("_id");

			if (!user) {
				results.push({ status: "no_match", phone: rawPhone });
				continue;
			}

			await upsertBcaRecordForUser(
				user._id as Types.ObjectId,
				record,
				receivedAt,
			);
			results.push({
				status: "synced",
				phone: rawPhone,
				userId: user._id.toString(),
			});
		} catch (err) {
			console.error("[internal/bca/ingest] Failed to process record", err);
			results.push({ status: "invalid", reason: "Processing failed" });
		}
	}

	const synced = results.filter((r) => r.status === "synced").length;
	res
		.status(200)
		.json({ ok: true, received: records.length, synced, results });
});

export default router;
