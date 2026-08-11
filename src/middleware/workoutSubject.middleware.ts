import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { assertTrainerOwnsMember } from "../services/trainerRoster.service";

/** Member acting on their own workout data. */
export const subjectIsSelf: RequestHandler = (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	req.subjectUserId = req.user.id;
	next();
};

/**
 * A trainer (or admin) acting on a roster member's workout data. Reads
 * `:userId` from the route — the router this is mounted under must carry
 * that param (and `mergeParams: true` if it's a nested sub-router).
 */
export const subjectIsMember: RequestHandler = async (req, res, next) => {
	try {
		const rawUserId = req.params.userId;
		const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			res.status(400).json({
				error: "Invalid member ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		if (req.user!.role === "trainer") {
			await assertTrainerOwnsMember(req.user!.id, userId);
		}

		req.subjectUserId = userId;
		next();
	} catch (error) {
		next(error);
	}
};
