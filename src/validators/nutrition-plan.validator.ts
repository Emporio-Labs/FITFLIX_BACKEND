import z from "zod";
import { NutritionGoal, NutritionPlanStatus } from "../models/Enums";
import {
	daySchema,
	daysArraySchema,
	macroTargetSchema,
	optionalDate,
	requiredDate,
} from "./nutrition-shared.validator";

const goalValues = Object.values(NutritionGoal) as [string, ...string[]];
const statusValues = Object.values(NutritionPlanStatus) as [
	string,
	...string[],
];

export const assignTemplateBodySchema = z.object({
	userId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid user ID"),
	startDate: requiredDate,
	endDate: optionalDate,
});

export const createAdHocPlanBodySchema = z.object({
	userId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid user ID"),
	name: z.string().trim().min(1, "Plan name is required"),
	goal: z.enum(goalValues, {
		message: `Goal must be one of: ${goalValues.join(", ")}`,
	}),
	startDate: requiredDate,
	endDate: optionalDate,
	targetCaloriesKcal: z.coerce
		.number()
		.min(0)
		.max(100000)
		.nullable()
		.optional(),
	targetMacros: macroTargetSchema,
	durationDays: z.coerce.number().int().min(1).max(366).optional(),
	days: daysArraySchema,
});

export const updatePlanBodySchema = z.object({
	name: z.string().trim().min(1).optional(),
	goal: z.enum(goalValues).optional(),
	startDate: optionalDate,
	endDate: optionalDate,
	targetCaloriesKcal: z.coerce
		.number()
		.min(0)
		.max(100000)
		.nullable()
		.optional(),
	targetMacros: macroTargetSchema,
	durationDays: z.coerce.number().int().min(1).max(366).optional(),
	days: z.array(daySchema).optional(),
});

export const planStatusBodySchema = z.object({
	status: z.enum(statusValues, {
		message: `Status must be one of: ${statusValues.join(", ")}`,
	}),
});

export const planListQuerySchema = z.object({
	status: z.enum(statusValues).optional(),
});

export type AssignTemplateBody = z.infer<typeof assignTemplateBodySchema>;
export type CreateAdHocPlanBody = z.infer<typeof createAdHocPlanBodySchema>;
export type UpdatePlanBody = z.infer<typeof updatePlanBodySchema>;
export type PlanStatusBody = z.infer<typeof planStatusBodySchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;
