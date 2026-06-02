import { z } from "zod";
import { NutritionGoal } from "../models/Enums";

export const recipeBrowseQuerySchema = z.object({
	isVeg: z
		.string()
		.optional()
		.transform((v) =>
			v === "true" ? true : v === "false" ? false : undefined,
		),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(200).default(50),
});

// z.nativeEnum returns the TypeScript enum type directly, avoiding the
// string-vs-NutritionGoal mismatch that z.enum(string[]) produces.
export const buildTemplateFromCategoryBody = z.object({
	name: z.string().trim().min(1, "Template name is required"),
	goal: z.nativeEnum(NutritionGoal),
	tags: z.array(z.string().trim().min(1)).default([]),
});

export const buildTemplateFromRecipeBody = z.object({
	name: z.string().trim().min(1, "Template name is required"),
	goal: z.nativeEnum(NutritionGoal),
	tags: z.array(z.string().trim().min(1)).default([]),
});
