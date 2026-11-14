import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	createGoal,
	getMyGoals,
	updateGoal,
} from "../services/goal.service";
import {
	createGoalSchema,
	updateGoalSchema,
} from "../validators/goal.validator";

export const getMyGoalsHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const goals = await getMyGoals(userId);

		res.status(200).json({
			success: true,
			goals,
		});
	} catch (error) {
		next(error);
	}
};

export const createGoalHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = createGoalSchema.safeParse(req.body);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const goal = await createGoal(userId, parsed.data);

		res.status(201).json({
			success: true,
			goal,
		});
	} catch (error) {
		next(error);
	}
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam))
		return null;
	return idParam;
};

export const updateGoalHandler: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		const goalId = getIdParam(req.params.id);
		if (!userId || !goalId) {
			res.status(400).json({ error: "Invalid request", code: "BAD_REQUEST" });
			return;
		}

		const parsed = updateGoalSchema.safeParse(req.body);
		if (!parsed.success) {
			const details: Record<string, string> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path.map(String).join(".");
				details[key] = issue.message;
			}
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details,
			});
			return;
		}

		const goal = await updateGoal(userId, goalId, parsed.data);

		res.status(200).json({
			success: true,
			goal,
		});
	} catch (error) {
		next(error);
	}
};

export const getMemberGoalsForStaffHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const requesterRole = req.user?.role;
		if (
			!["admin", "frontdesk", "trainer", "nutritionist", "doctor"].includes(
				requesterRole || "",
			)
		) {
			res.status(403).json({
				error: "Forbidden: Staff access required",
				code: "FORBIDDEN",
			});
			return;
		}

		const targetUserId = getIdParam(req.params.userId);
		if (!targetUserId) {
			res.status(400).json({
				error: "Invalid target user id",
				code: "BAD_REQUEST",
			});
			return;
		}

		const goals = await getMyGoals(targetUserId);

		res.status(200).json({
			success: true,
			goals,
		});
	} catch (error) {
		next(error);
	}
};
