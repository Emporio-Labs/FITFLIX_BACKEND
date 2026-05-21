import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	getDashboardMembers,
	getDashboardStats,
	getUserNutritionDashboard,
} from "../services/nutrition/nutrition-dashboard.service";
import {
	getValidationDetails,
	handleNutritionError,
} from "../services/nutrition/nutrition-errors";
import { dashboardMembersQuerySchema } from "../validators/nutrition-dashboard.validator";

export const stats: RequestHandler = async (_req, res, next) => {
	try {
		const data = await getDashboardStats();
		res.status(200).json(data);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const members: RequestHandler = async (req, res, next) => {
	const parsed = dashboardMembersQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const data = await getDashboardMembers(parsed.data);
		res.status(200).json(data);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const userDashboard: RequestHandler = async (req, res, next) => {
	const rawUserId = req.params.userId;
	const userId = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;

	// Validate userId format
	if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { userId: "Invalid user ID format" },
		});
		return;
	}

	try {
		const dashboard = await getUserNutritionDashboard(userId);
		res.status(200).json(dashboard);
	} catch (error: any) {
		if (error.message === "User not found") {
			res.status(404).json({
				error: "User not found",
				code: "NOT_FOUND",
			});
			return;
		}
		handleNutritionError(error, res, next);
	}
};
