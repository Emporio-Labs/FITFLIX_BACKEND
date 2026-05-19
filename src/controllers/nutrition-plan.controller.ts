import type { RequestHandler } from "express";
import type { NutritionGoal, NutritionPlanStatus } from "../models/Enums";
import {
	assignTemplateToUser,
	createAdHocPlan,
	getPlan,
	listNutritionistPlans,
	listUserPlans,
	setPlanStatus,
	updatePlan,
} from "../services/nutrition/nutrition-assignment.service";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	generatePlanPdf,
	getPlanPdf,
} from "../services/nutrition/nutrition-plan-pdf.service";
import type { DayInput } from "../types/nutrition";
import {
	assignTemplateBodySchema,
	createAdHocPlanBodySchema,
	planListQuerySchema,
	planStatusBodySchema,
	updatePlanBodySchema,
} from "../validators/nutrition-plan.validator";

export const assignTemplate: RequestHandler = async (req, res, next) => {
	const parsed = assignTemplateBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const templateId = requireIdParam(
			req.params.id,
			"Template not found",
		);
		const plan = await assignTemplateToUser(
			templateId,
			parsed.data.userId,
			req.user!,
			{
				startDate: parsed.data.startDate,
				endDate: parsed.data.endDate ?? null,
			},
		);
		res.status(201).json({ message: "Template assigned", plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const createPlan: RequestHandler = async (req, res, next) => {
	const parsed = createAdHocPlanBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const { userId, goal, days, ...rest } = parsed.data;
		const plan = await createAdHocPlan(
			{
				...rest,
				goal: goal as NutritionGoal,
				days: days as DayInput[],
			},
			userId,
			req.user!.id,
		);
		res.status(201).json({ message: "Plan created", plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listManagedPlans: RequestHandler = async (req, res, next) => {
	const parsed = planListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const plans = await listNutritionistPlans(req.user!.id, {
			status: parsed.data.status as NutritionPlanStatus | undefined,
		});
		res.status(200).json({ plans });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanById: RequestHandler = async (req, res, next) => {
	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await getPlan(planId, req.user!);
		res.status(200).json({ plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const patchPlan: RequestHandler = async (req, res, next) => {
	const parsed = updatePlanBodySchema.safeParse(req.body);
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
		const { goal, days, ...rest } = parsed.data;
		const plan = await updatePlan(
			planId,
			{
				...rest,
				goal: goal as NutritionGoal | undefined,
				days: days as DayInput[] | undefined,
			},
			req.user!,
		);
		res.status(200).json({ message: "Plan updated", plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const changePlanStatus: RequestHandler = async (req, res, next) => {
	const parsed = planStatusBodySchema.safeParse(req.body);
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
		const plan = await setPlanStatus(
			planId,
			parsed.data.status as NutritionPlanStatus,
			req.user!,
		);
		res.status(200).json({ message: "Plan status updated", plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listMyPlans: RequestHandler = async (req, res, next) => {
	const parsed = planListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const plans = await listUserPlans(req.user!.id, {
			status: parsed.data.status as NutritionPlanStatus | undefined,
		});
		res.status(200).json({ plans });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getMyPlanById: RequestHandler = async (req, res, next) => {
	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await getPlan(planId, req.user!);
		res.status(200).json({ plan });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const generatePlanPdfHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const result = await generatePlanPdf(planId, req.user!);
		res.status(200).json({ message: "Plan PDF generated", ...result });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanPdfHandler: RequestHandler = async (req, res, next) => {
	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const result = await getPlanPdf(planId, req.user!);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
