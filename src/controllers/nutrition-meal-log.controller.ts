import type { RequestHandler } from "express";
import type { MealLogSource, MealLogStatus } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	deleteMealLog,
	listLogs,
	logMeal,
	markMealCompleted,
	updateMealLog,
} from "../services/nutrition/nutrition-meal-log.service";
import {
	listMealLogsQuerySchema,
	logMealBodySchema,
	markMealCompletedBodySchema,
	updateMealLogBodySchema,
} from "../validators/nutrition-meal-log.validator";

export const createMealLog: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = logMealBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const log = await logMeal(
			{
				...parsed.data,
				status: parsed.data.status as MealLogStatus | undefined,
				source: parsed.data.source as MealLogSource | undefined,
			},
			requester.id,
		);
		res.status(201).json({ message: "Meal logged", mealLog: log });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const completePlanMeal: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = markMealCompletedBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const log = await markMealCompleted(
			planId,
			parsed.data.dayNumber,
			parsed.data.mealIndex,
			requester.id,
			parsed.data.date,
			parsed.data.completedOptionId ?? null,
		);
		res.status(200).json({ message: "Meal marked completed", mealLog: log });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listMyMealLogs: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = listMealLogsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const result = await listLogs(requester.id, parsed.data);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const patchMealLog: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = updateMealLogBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const logId = requireIdParam(req.params.id, "Meal log not found");
		const log = await updateMealLog(
			logId,
			{
				...parsed.data,
				status: parsed.data.status as MealLogStatus | undefined,
			},
			requester.id,
		);
		res.status(200).json({ message: "Meal log updated", mealLog: log });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const removeMealLog: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	try {
		const logId = requireIdParam(req.params.id, "Meal log not found");
		await deleteMealLog(logId, requester.id);
		res.status(200).json({ message: "Meal log deleted" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
