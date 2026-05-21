import z from "zod";
import { NutritionFoodSource } from "../models/Enums";
import { optionalNutritionString } from "./nutrition-shared.validator";

const sourceValues = Object.values(NutritionFoodSource) as [
	string,
	...string[],
];

export const createFoodBodySchema = z.object({
	name: z.string().trim().min(1, "Food name is required"),
	brand: optionalNutritionString.nullable(),
	basePer: z.coerce.number().positive().max(10000).optional(),
	servingLabel: optionalNutritionString,
	caloriesKcal: z.coerce.number().min(0).max(100000),
	proteinG: z.coerce.number().min(0).max(10000),
	carbsG: z.coerce.number().min(0).max(10000),
	fatG: z.coerce.number().min(0).max(10000),
	fiberG: z.coerce.number().min(0).max(10000).nullable().optional(),
	sugarG: z.coerce.number().min(0).max(10000).nullable().optional(),
	barcode: optionalNutritionString.nullable(),
	isVeg: z.boolean().optional(),
	allergens: z.array(z.string().trim().min(1)).optional(),
	mealTypes: z.array(z.string().trim().min(1)).optional(),
	tags: z.array(z.string().trim().min(1)).optional(),
});

export const updateFoodBodySchema = createFoodBodySchema.partial();

export const foodSearchQuerySchema = z.object({
	query: optionalNutritionString,
	source: z.enum(sourceValues).optional(),
	page: z.coerce.number().int().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type CreateFoodBody = z.infer<typeof createFoodBodySchema>;
export type UpdateFoodBody = z.infer<typeof updateFoodBodySchema>;
export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;
