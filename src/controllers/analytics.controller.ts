import type { RequestHandler } from "express";
import { buildUserAnalytics } from "../services/analytics.service";
import { getValidationDetails } from "../services/nutrition/nutrition-errors";
import { analyticsQuerySchema } from "../validators/analytics.validator";

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
		const analytics = await buildUserAnalytics(req.user.id, parsed.data.period);
		res.status(200).json(analytics);
	} catch (error) {
		next(error);
	}
};
