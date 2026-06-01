import type { RequestHandler } from "express";
import {
	getAdherenceRange,
	getPlanAdherenceSummary,
	getWeeklyAdherence,
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
import UserNutritionPlan from "../models/nutrition-plan.model";

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
		const isStaff = ["nutritionist", "admin"].includes(req.user!.role);
		const targetUserId = (isStaff && parsed.data.userId) ? parsed.data.userId : req.user!.id;

		let planId = parsed.data.planId;
		if (!planId) {
			const latestPlan = await UserNutritionPlan.findOne({ userId: targetUserId }).sort({ createdAt: -1 });
			if (!latestPlan) {
				res.status(200).json({ days: [] });
				return;
			}
			planId = latestPlan._id.toString();
		}

		// Authorize plan access for this user before reading rollups.
		await getPlan(planId, req.user!);
		const days = await getAdherenceRange(
			targetUserId,
			planId,
			parsed.data.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
			parsed.data.to ?? new Date(),
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

export const getMyWeeklyAdherence: RequestHandler = async (req, res, next) => {
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
		const isStaff = ["nutritionist", "admin"].includes(req.user!.role);
		const targetUserId = (isStaff && parsed.data.userId) ? parsed.data.userId : req.user!.id;

		let planId = parsed.data.planId;
		if (!planId) {
			const latestPlan = await UserNutritionPlan.findOne({ userId: targetUserId }).sort({ createdAt: -1 });
			if (!latestPlan) {
				res.status(200).json({ adherence: [], weeklyAverage: 0 });
				return;
			}
			planId = latestPlan._id.toString();
		}

		await getPlan(planId, req.user!);
		const result = await getWeeklyAdherence(
			targetUserId,
			planId,
			parsed.data.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
			parsed.data.to ?? new Date(),
		);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanWeeklyAdherence: RequestHandler = async (req, res, next) => {
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
		const plan = await getPlan(planId, req.user!);
		const rawUserId = plan.userId as unknown;
		const planOwnerId =
			rawUserId && typeof rawUserId === "object" && "_id" in rawUserId
				? String((rawUserId as { _id: unknown })._id)
				: String(rawUserId);
		const result = await getWeeklyAdherence(
			planOwnerId,
			planId,
			parsed.data.from,
			parsed.data.to,
		);
		res.status(200).json(result);
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
