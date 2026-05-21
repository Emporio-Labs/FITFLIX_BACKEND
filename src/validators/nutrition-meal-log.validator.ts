import z from "zod";
import { MealLogSource, MealLogStatus } from "../models/Enums";
import {
	mealItemSchema,
	objectIdString,
	optionalDate,
	requiredDate,
} from "./nutrition-shared.validator";

const statusValues = Object.values(MealLogStatus) as [string, ...string[]];
const sourceValues = Object.values(MealLogSource) as [string, ...string[]];

export const logMealBodySchema = z.object({
	planId: objectIdString.nullable().optional(),
	logDate: optionalDate,
	status: z.enum(statusValues).optional(),
	source: z.enum(sourceValues).optional(),
	plannedMealRef: z
		.object({
			dayNumber: z.coerce.number().int().min(1).max(366),
			mealIndex: z.coerce.number().int().min(0).max(50),
			selectedOptionId: objectIdString.nullable().optional(),
			completedOptionId: objectIdString.nullable().optional(),
		})
		.nullable()
		.optional(),
	notes: z.string().trim().max(1000).optional(),
	photoUrls: z.array(z.string().trim().url()).max(10).optional(),
	items: z.array(mealItemSchema).min(1, "At least one item is required"),
});

export const markMealCompletedBodySchema = z.object({
	dayNumber: z.coerce.number().int().min(1).max(366),
	mealIndex: z.coerce.number().int().min(0).max(50),
	date: optionalDate,
	completedOptionId: objectIdString.nullable().optional(),
});

export const updateMealLogBodySchema = z.object({
	status: z.enum(statusValues).optional(),
	notes: z.string().trim().max(1000).optional(),
	photoUrls: z.array(z.string().trim().url()).max(10).optional(),
	items: z.array(mealItemSchema).min(1).optional(),
});

export const listMealLogsQuerySchema = z.object({
	planId: objectIdString.optional(),
	from: optionalDate,
	to: optionalDate,
	page: z.coerce.number().int().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const adherenceRangeQuerySchema = z.object({
	planId: objectIdString,
	from: requiredDate,
	to: requiredDate,
});

export const planAdherenceQuerySchema = z.object({
	from: requiredDate,
	to: requiredDate,
});

export const rebuildAdherenceBodySchema = z.object({
	planId: objectIdString,
});

export type LogMealBody = z.infer<typeof logMealBodySchema>;
export type MarkMealCompletedBody = z.infer<
	typeof markMealCompletedBodySchema
>;
export type UpdateMealLogBody = z.infer<typeof updateMealLogBodySchema>;
export type ListMealLogsQuery = z.infer<typeof listMealLogsQuerySchema>;
