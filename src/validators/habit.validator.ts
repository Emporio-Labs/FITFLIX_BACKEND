import { z } from "zod";
import { HabitCategory, HabitFrequency, HabitLogSource } from "../models/Enums";

export const toggleHabitSchema = z.object({
	habitId: z.string().trim().min(1, "habitId is required"),
	date: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
		.optional(),
	source: z.nativeEnum(HabitLogSource).optional(),
});

export const createHabitSchema = z.object({
	title: z.string().trim().min(1, "title is required"),
	description: z.string().trim().optional(),
	category: z.nativeEnum(HabitCategory).default(HabitCategory.Custom),
	icon: z.string().trim().min(1).default("check_circle"),
	timeOfDayHint: z.enum(["MORNING", "ANYTIME", "EVENING"]).default("ANYTIME"),
	frequency: z.nativeEnum(HabitFrequency).default(HabitFrequency.Daily),
	targetDaysPerWeek: z.number().int().min(1).max(7).default(7),
	isPinnedToHome: z.boolean().default(false),
});

export const updateHabitSchema = createHabitSchema.partial().extend({
	isActive: z.boolean().optional(),
	isPinnedToHome: z.boolean().optional(),
	pinnedOrder: z.number().int().optional(),
});

export type ToggleHabitInput = z.infer<typeof toggleHabitSchema>;
export type CreateHabitInput = z.infer<typeof createHabitSchema>;
export type UpdateHabitInput = z.infer<typeof updateHabitSchema>;
