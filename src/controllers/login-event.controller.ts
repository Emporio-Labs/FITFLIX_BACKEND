import type { RequestHandler } from "express";
import LoginEvent from "../models/LoginEvent";
import { listLoginEventsQuerySchema } from "../validators/login-event.validator";

const MAX_RANGE_DAYS = 92;
const MAX_EVENTS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /admins/login-events?from=YYYY-MM-DD&to=YYYY-MM-DD[&role=]
 *
 * Raw login rows for the front desk "Login Activity" report. `from`/`to` are
 * whole IST calendar days (inclusive); the page does the daily/per-person
 * rollups so the API stays one simple read.
 */
export const listLoginEvents: RequestHandler = async (req, res, next) => {
	const parsed = listLoginEventsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			message: "Invalid login events query",
			errors: parsed.error.issues,
		});
		return;
	}

	const { from, to, role } = parsed.data;
	const start = new Date(`${from}T00:00:00+05:30`);
	const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + DAY_MS);
	if ((end.getTime() - start.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
		res.status(400).json({
			message: `Date range cannot exceed ${MAX_RANGE_DAYS} days`,
		});
		return;
	}

	try {
		const filter: Record<string, unknown> = {
			createdAt: { $gte: start, $lt: end },
		};
		if (role) filter.role = role;

		const events = await LoginEvent.find(filter)
			.select("-userAgent")
			.populate("locationId", "name")
			.sort({ createdAt: -1 })
			.limit(MAX_EVENTS + 1);

		res.status(200).json({
			items: events.slice(0, MAX_EVENTS),
			truncated: events.length > MAX_EVENTS,
		});
	} catch (error) {
		next(error);
	}
};
