import z from "zod";
import { NutritionGoal, NutritionPlanStatus } from "../models/Enums";
import {
	daysArraySchema,
	macroTargetSchema,
} from "./nutrition-shared.validator";

const goalValues = Object.values(NutritionGoal) as [string, ...string[]];
const statusValues = Object.values(NutritionPlanStatus) as [
	string,
	...string[],
];

export const createTemplateBodySchema = z.object({
	name: z.string().trim().min(1, "Template name is required"),
	description: z.string().trim().max(2000).optional(),
	goal: z.enum(goalValues, {
		message: `Goal must be one of: ${goalValues.join(", ")}`,
	}),
	status: z.enum(statusValues).optional(),
	tags: z.array(z.string().trim().min(1)).default([]),
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

export const updateTemplateBodySchema = createTemplateBodySchema.partial();

export const templateListQuerySchema = z.object({
	status: z.enum(statusValues).optional(),
	goal: z.enum(goalValues).optional(),
	tag: z.string().trim().min(1).optional(),
});

export type CreateTemplateBody = z.infer<typeof createTemplateBodySchema>;
export type UpdateTemplateBody = z.infer<typeof updateTemplateBodySchema>;
export type TemplateListQuery = z.infer<typeof templateListQuerySchema>;
