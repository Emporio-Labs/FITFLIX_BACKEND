import z from "zod";
import { NutritionPlanStatus } from "../models/Enums";
import {
	daySchema,
	daysArraySchema,
	goalSchema,
	lifestyleRecommendationSchema,
	macroTargetSchema,
	objectIdString,
	optionalDate,
	optionalGoalSchema,
	requiredDate,
} from "./nutrition-shared.validator";

const statusValues = Object.values(NutritionPlanStatus) as [
	string,
	...string[],
];

export const assignTemplateBodySchema = z.object({
	userId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid user ID"),
	startDate: optionalDate,
	endDate: optionalDate,
});

export const createAdHocPlanBodySchema = z.object({
	userId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid user ID"),
	name: z.string().trim().min(1, "Plan name is required"),
	goal: goalSchema,
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
	days: daysArraySchema,
	lifestyleRecommendations: z.array(lifestyleRecommendationSchema).default([]),
});

export const updatePlanBodySchema = z.object({
	name: z.string().trim().min(1).optional(),
	goal: optionalGoalSchema,
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
	lifestyleRecommendations: z.array(lifestyleRecommendationSchema).optional(),
});

export const duplicatePlanBodySchema = z.object({
	targetUserId: objectIdString.optional(),
	name: z.string().trim().min(1).optional(),
});

export const planStatusBodySchema = z.object({
	status: z.enum(statusValues, {
		message: `Status must be one of: ${statusValues.join(", ")}`,
	}),
});

export const planListQuerySchema = z.object({
	status: z.enum(statusValues).optional(),
	userId: z
		.string()
		.trim()
		.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid user ID")
		.optional(),
});

export const copyDayStructureSchema = z.object({
	planId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Plan ID"),
	sourceDayOfWeek: z.enum([
		"Sunday",
		"Monday",
		"Tuesday",
		"Wednesday",
		"Thursday",
		"Friday",
		"Saturday",
	]),
	targetDaysOfWeek: z.array(
		z.enum([
			"Sunday",
			"Monday",
			"Tuesday",
			"Wednesday",
			"Thursday",
			"Friday",
			"Saturday",
		]),
	),
	strategy: z.enum(["replicate", "alternate", "split_week"]),
});

export type AssignTemplateBody = z.infer<typeof assignTemplateBodySchema>;
export type CreateAdHocPlanBody = z.infer<typeof createAdHocPlanBodySchema>;
export type UpdatePlanBody = z.infer<typeof updatePlanBodySchema>;
export type PlanStatusBody = z.infer<typeof planStatusBodySchema>;
export type PlanListQuery = z.infer<typeof planListQuerySchema>;
export type DuplicatePlanBody = z.infer<typeof duplicatePlanBodySchema>;
export type CopyDayStructureBody = z.infer<typeof copyDayStructureSchema>;
