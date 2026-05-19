import type { RequestHandler } from "express";
import { ProgressRecordedBy } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	addPlanProgress,
	addProgressEntry,
	getPlanProgress,
	listProgress,
} from "../services/nutrition/nutrition-progress.service";
import {
	progressBodySchema,
	progressListQuerySchema,
} from "../validators/nutrition-progress.validator";

export const addMyProgress: RequestHandler = async (req, res, next) => {
	const parsed = progressBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const entry = await addProgressEntry(
			parsed.data,
			req.user!.id,
			ProgressRecordedBy.User,
		);
		res.status(201).json({ message: "Progress recorded", entry });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listMyProgress: RequestHandler = async (req, res, next) => {
	const parsed = progressListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const entries = await listProgress(req.user!.id, parsed.data);
		res.status(200).json({ entries });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listPlanProgress: RequestHandler = async (req, res, next) => {
	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const entries = await getPlanProgress(planId, req.user!);
		res.status(200).json({ entries });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const addPlanProgressEntry: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = progressBodySchema.safeParse(req.body);
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
		const entry = await addPlanProgress(planId, parsed.data, req.user!);
		res.status(201).json({ message: "Progress recorded", entry });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
