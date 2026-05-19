import type { RequestHandler } from "express";
import type { NutritionGoal, NutritionPlanStatus } from "../models/Enums";
import {
	getValidationDetails,
	handleNutritionError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	createTemplate,
	deleteTemplate,
	getTemplate,
	listTemplates,
	updateTemplate,
} from "../services/nutrition/nutrition-template.service";
import type { DayInput } from "../types/nutrition";
import {
	createTemplateBodySchema,
	templateListQuerySchema,
	updateTemplateBodySchema,
} from "../validators/nutrition-template.validator";

export const createNutritionTemplate: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = createTemplateBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const template = await createTemplate(
			{
				...parsed.data,
				goal: parsed.data.goal as NutritionGoal,
				status: parsed.data.status as NutritionPlanStatus | undefined,
				days: parsed.data.days as DayInput[],
			},
			req.user!.id,
		);
		res.status(201).json({ message: "Template created", template });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const listNutritionTemplates: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = templateListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const templates = await listTemplates(req.user!.id, {
			status: parsed.data.status as NutritionPlanStatus | undefined,
			goal: parsed.data.goal as NutritionGoal | undefined,
			tag: parsed.data.tag,
		});
		res.status(200).json({ templates });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getNutritionTemplate: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const id = requireIdParam(req.params.id, "Template not found");
		const template = await getTemplate(id, req.user!);
		res.status(200).json({ template });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const updateNutritionTemplate: RequestHandler = async (
	req,
	res,
	next,
) => {
	const parsed = updateTemplateBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const id = requireIdParam(req.params.id, "Template not found");
		const template = await updateTemplate(
			id,
			{
				...parsed.data,
				goal: parsed.data.goal as NutritionGoal | undefined,
				status: parsed.data.status as NutritionPlanStatus | undefined,
				days: parsed.data.days as DayInput[] | undefined,
			},
			req.user!,
		);
		res.status(200).json({ message: "Template updated", template });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const deleteNutritionTemplate: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const id = requireIdParam(req.params.id, "Template not found");
		await deleteTemplate(id, req.user!);
		res.status(200).json({ message: "Template deleted" });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
