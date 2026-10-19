import type { RequestHandler } from "express";
import { buildUserAnalytics } from "../services/analytics.service";
import { buildBranchFunnels } from "../services/branch-funnels.service";
import { getValidationDetails } from "../services/nutrition/nutrition-errors";
import { autoPullBcaIfEmpty } from "../utils/activex.service";
import {
	LocationError,
	mapLocationError,
	readExplicitLocationId,
	scopedLocationFilter,
} from "../utils/location.resolver";
import {
	analyticsQuerySchema,
	branchFunnelsQuerySchema,
} from "../validators/analytics.validator";

/**
 * `GET /analytics/me` — everything the Progress screen renders, in one call.
 *
 * Self-only by construction: the subject is always `req.user.id` and there is
 * no `userId` parameter to authorize. A member with no data still gets a 200
 * with every block flagged `hasData: false`, because an empty dashboard is a
 * state to design for, not an error to raise.
 */
export const getMyAnalytics: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = analyticsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		await autoPullBcaIfEmpty(req.user.id);
		const analytics = await buildUserAnalytics(req.user.id, parsed.data.period);
		res.status(200).json(analytics);
	} catch (error) {
		next(error);
	}
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const parseDay = (raw?: string): Date | null => {
	if (!raw) return null;
	const d = new Date(raw);
	return Number.isNaN(d.getTime()) ? null : d;
};

const toDayString = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * `GET /analytics/funnels` — the Frontdesk Analytics page's sign-up and booking
 * funnels for one branch (FX-27).
 *
 * Branch access is enforced upstream: `staffGuard` set `req.allowedBranchIds`
 * (null for a global/super admin, the caller's branches otherwise), and
 * `scopedLocationFilter` turns that plus the requested branch into a Mongo
 * filter — a branch-scoped manager can only ever see their own branches, and an
 * out-of-scope branch id matches nothing rather than leaking (FX-27.2). The
 * service key (requireAnalyticsKey) and the admin/frontdesk role gate are
 * applied by the route (FX-27.3/.4).
 */
export const getBranchFunnels: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = branchFunnelsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const explicitId = readExplicitLocationId(req);

		let locationFilter: Record<string, unknown>;
		try {
			locationFilter = scopedLocationFilter(req.allowedBranchIds, explicitId);
		} catch (error) {
			if (error instanceof LocationError) {
				const mapped = mapLocationError(error);
				res.status(mapped.status).json({
					error: mapped.message,
					code: mapped.code,
				});
				return;
			}
			throw error;
		}

		// Default to the last 30 days, matching getVisitAnalytics. `to` is an
		// inclusive calendar day: a date-only value is extended to end-of-day so
		// that day's rows are counted.
		const from = parsed.data.from
			? (parseDay(parsed.data.from) ?? new Date(Date.now() - 30 * DAY_MS))
			: new Date(Date.now() - 30 * DAY_MS);
		const to = parseDay(parsed.data.to) ?? new Date();
		if (parsed.data.to && DATE_ONLY.test(parsed.data.to)) {
			to.setUTCHours(23, 59, 59, 999);
		}

		const funnels = await buildBranchFunnels({ locationFilter, from, to });

		res.status(200).json({
			branchId: explicitId ?? null,
			range: { from: toDayString(from), to: toDayString(to) },
			funnels,
			generatedAt: new Date().toISOString(),
			configured: true,
		});
	} catch (error) {
		next(error);
	}
};
