import z from "zod";
import { MealLogSource, MealLogStatus, MealType } from "../models/Enums";
import {
	objectIdString,
	optionalDate,
	requiredDate,
} from "./nutrition-shared.validator";

const statusValues = Object.values(MealLogStatus) as [string, ...string[]];
const sourceValues = Object.values(MealLogSource) as [string, ...string[]];
const mealTypeValues = Object.values(MealType) as [string, ...string[]];

// Meal-log item — deliberately separate from mealItemSchema
// (nutrition-shared.validator.ts), which is shared by template/plan
// authoring and must stay a strict {foodId, quantityG} catalog reference.
// A log item may instead reference an external (not-yet-cached) food, or be
// fully free-text with caller-supplied macros — the model already supports
// this (loggedItemSchema.foodId is nullable), only the validator didn't.
export const logItemSchema = z
	.object({
		foodId: objectIdString.optional(),
		externalRef: z
			.object({
				source: z.literal("OpenFoodFacts"),
				id: z.string().trim().min(1),
			})
			.optional(),
		foodName: z.string().trim().min(1).optional(),
		caloriesKcal: z.coerce.number().min(0).max(100000).optional(),
		proteinG: z.coerce.number().min(0).max(10000).optional(),
		carbsG: z.coerce.number().min(0).max(10000).optional(),
		fatG: z.coerce.number().min(0).max(10000).optional(),
		fiberG: z.coerce.number().min(0).max(10000).nullable().optional(),
		sugarG: z.coerce.number().min(0).max(10000).nullable().optional(),
		// Either quantityG directly, or a household serving that resolves to
		// grams server-side (resolveQuantityG) before scaleMacros ever runs.
		quantityG: z.coerce.number().positive().max(10000).optional(),
		servingLabel: z.string().trim().min(1).optional(),
		servingCount: z.coerce.number().positive().max(1000).optional(),
		recipeSource: z.string().trim().optional(),
	})
	.refine(
		(item) =>
			[item.foodId, item.externalRef, item.foodName].filter(Boolean).length ===
			1,
		{ message: "Provide exactly one of foodId, externalRef, or foodName" },
	)
	.refine(
		(item) =>
			!item.foodName ||
			(item.caloriesKcal !== undefined &&
				item.proteinG !== undefined &&
				item.carbsG !== undefined &&
				item.fatG !== undefined),
		{
			message:
				"foodName items must include caloriesKcal, proteinG, carbsG, and fatG",
		},
	)
	.refine(
		(item) =>
			item.quantityG !== undefined ||
			(item.servingLabel !== undefined && item.servingCount !== undefined),
		{ message: "Provide quantityG, or both servingLabel and servingCount" },
	);

export const logMealBodySchema = z.object({
	planId: objectIdString.nullable().optional(),
	logDate: optionalDate,
	status: z.enum(statusValues).optional(),
	source: z.enum(sourceValues).optional(),
	mealType: z.enum(mealTypeValues).optional(),
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
	items: z.array(logItemSchema).min(1, "At least one item is required"),
});

export const markMealCompletedBodySchema = z.object({
	dayNumber: z.coerce.number().int().min(1).max(366),
	mealIndex: z.coerce.number().int().min(0).max(50),
	date: optionalDate,
	completedOptionId: objectIdString.nullable().optional(),
});

export const updateMealLogBodySchema = z.object({
	status: z.enum(statusValues).optional(),
	mealType: z.enum(mealTypeValues).optional(),
	notes: z.string().trim().max(1000).optional(),
	photoUrls: z.array(z.string().trim().url()).max(10).optional(),
	items: z.array(logItemSchema).min(1).optional(),
});

// scope narrows the mixed plan-linked / plan-less log stream now that a log
// can have planId: null. Omitted (or "all") reproduces exactly today's
// unfiltered behavior — every existing caller keeps working unchanged.
export const listMealLogsQuerySchema = z.object({
	planId: objectIdString.optional(),
	userId: objectIdString.optional(),
	scope: z.enum(["diary", "plan", "all"]).optional(),
	from: optionalDate,
	to: optionalDate,
	page: z.coerce.number().int().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const adherenceRangeQuerySchema = z.object({
	// Omitted -> auto-resolve to the user's latest plan (legacy default).
	// The literal "none" forces the plan-less rollup even when the user has
	// a plan on record — the free-form diary UI needs this explicitly, since
	// "no planId given" alone can't be told apart from "resolve to whatever
	// plan exists" otherwise.
	planId: z.union([objectIdString, z.literal("none")]).optional(),
	userId: objectIdString.optional(),
	from: optionalDate,
	to: optionalDate,
});

export const planAdherenceQuerySchema = z.object({
	from: requiredDate,
	to: requiredDate,
});

// Either planId (rebuild a plan's rollups) or userId (rebuild a user's
// plan-less diary rollups) — exactly one, not both.
export const rebuildAdherenceBodySchema = z
	.object({
		planId: objectIdString.optional(),
		userId: objectIdString.optional(),
	})
	.refine((v) => Boolean(v.planId) !== Boolean(v.userId), {
		message: "Provide exactly one of planId or userId",
	});

export type LogItem = z.infer<typeof logItemSchema>;
export type LogMealBody = z.infer<typeof logMealBodySchema>;
export type MarkMealCompletedBody = z.infer<typeof markMealCompletedBodySchema>;
export type UpdateMealLogBody = z.infer<typeof updateMealLogBodySchema>;
export type ListMealLogsQuery = z.infer<typeof listMealLogsQuerySchema>;
