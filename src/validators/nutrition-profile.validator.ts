import z from "zod";
import { DietaryPreference, NutritionGoal } from "../models/Enums";
import { macroTargetSchema, objectIdString } from "./nutrition-shared.validator";

const goalValues = Object.values(NutritionGoal) as [string, ...string[]];
const dietaryValues = Object.values(DietaryPreference) as [string, ...string[]];

export const createProfileBodySchema = z.object({
	userId: objectIdString,
	goal: z.enum(goalValues, {
		message: `Goal must be one of: ${goalValues.join(", ")}`,
	}),
	dietaryPreference: z.enum(dietaryValues).optional(),
	allergies: z.array(z.string().trim().min(1)).optional(),
	medicalConditions: z.array(z.string().trim().min(1)).optional(),
	preferredFoods: z.array(z.string().trim().min(1)).optional(),
	dislikedFoods: z.array(z.string().trim().min(1)).optional(),
	targetCaloriesKcal: z.coerce.number().min(0).max(100000).nullable().optional(),
	targetMacros: macroTargetSchema,
	mealsPerDay: z.coerce.number().int().min(1).max(12).optional(),
	waterTargetLiters: z.coerce.number().min(0).max(20).nullable().optional(),
	notes: z.string().trim().max(4000).optional(),
});

export const updateProfileBodySchema = createProfileBodySchema
	.omit({ userId: true })
	.partial();

export const profileUserParamSchema = z.object({
	userId: objectIdString,
});

export type CreateProfileBody = z.infer<typeof createProfileBodySchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
