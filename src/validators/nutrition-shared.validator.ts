import z from "zod";
import { MealType } from "../models/Enums";

const mealTypeValues = Object.values(MealType) as [string, ...string[]];

export const optionalNutritionString = z.preprocess((value) => {
	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}
	return value;
}, z.string().trim().min(1).optional());

export const objectIdString = z
	.string()
	.trim()
	.regex(/^[0-9a-fA-F]{24}$/, "Must be a valid ObjectId");

export const macroTargetSchema = z
	.object({
		proteinG: z.number().min(0).nullable().optional(),
		carbsG: z.number().min(0).nullable().optional(),
		fatG: z.number().min(0).nullable().optional(),
		fiberG: z.number().min(0).nullable().optional(),
		sugarG: z.number().min(0).nullable().optional(),
	})
	.optional();

export const mealItemSchema = z.object({
	foodId: objectIdString,
	quantityG: z.coerce.number().positive().max(10000),
});

export const mealSchema = z.object({
	mealType: z.enum(mealTypeValues, {
		message: `Meal type must be one of: ${mealTypeValues.join(", ")}`,
	}),
	name: z.string().trim().min(1),
	timeOfDay: optionalNutritionString.nullable(),
	notes: z.string().trim().max(1000).optional(),
	items: z.array(mealItemSchema).default([]),
});

export const daySchema = z.object({
	dayNumber: z.coerce.number().int().min(1).max(366),
	meals: z.array(mealSchema).default([]),
});

export const daysArraySchema = z.array(daySchema).default([]);

const toDate = (value: unknown): unknown => {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (value instanceof Date) {
		return value;
	}
	if (typeof value === "string" || typeof value === "number") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}
	return value;
};

export const requiredDate = z.preprocess(toDate, z.date());
export const optionalDate = z.preprocess(toDate, z.date().optional());
