import type { RequestHandler } from "express";
import {
	getAdherenceRange,
	getPlanAdherenceSummary,
	rebuildAdherence,
} from "../services/nutrition/nutrition-adherence.service";
import { getPlan } from "../services/nutrition/nutrition-assignment.service";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	adherenceRangeQuerySchema,
	planAdherenceQuerySchema,
	rebuildAdherenceBodySchema,
} from "../validators/nutrition-meal-log.validator";

export const getMyAdherence: RequestHandler = async (req, res, next) => {
	const parsed = adherenceRangeQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		// Authorize plan access for this user before reading rollups.
		await getPlan(parsed.data.planId, req.user!);
		const days = await getAdherenceRange(
			req.user!.id,
			parsed.data.planId,
			parsed.data.from,
			parsed.data.to,
		);
		res.status(200).json({ days });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanAdherence: RequestHandler = async (req, res, next) => {
	const parsed = planAdherenceQuerySchema.safeParse(req.query);
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
		await getPlan(planId, req.user!);
		const summary = await getPlanAdherenceSummary(
			planId,
			parsed.data.from,
			parsed.data.to,
		);
		res.status(200).json({ summary });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const rebuildPlanAdherence: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = rebuildAdherenceBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const rebuilt = await rebuildAdherence(parsed.data.planId);
		res.status(200).json({
			message: "Adherence rebuilt",
			rebuiltDays: rebuilt,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
