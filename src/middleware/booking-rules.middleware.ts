import type { RequestHandler } from "express";
import { evaluateBookingRules } from "../services/booking-rules-engine.service";

export const validateBookingRulesMiddleware: RequestHandler = async (
	req,
	res,
	next,
) => {
	const userId = (req.user as any)?.id || (req.user as any)?.userId;

	if (!userId) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const { classId, sessionId, sessionDate, startTime } = req.body;

	try {
		const evaluation = await evaluateBookingRules({
			userId,
			classId,
			sessionId,
			sessionDate,
			startTime,
		});

		if (!evaluation.allowed) {
			res.status(evaluation.statusCode || 403).json({
				message: evaluation.message,
				details: evaluation.details,
			});
			return;
		}

		next();
	} catch (error) {
		next(error);
	}
};
