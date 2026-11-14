import { z } from "zod";
import { GoalStatus, GoalType } from "../models/Enums";

export const createGoalSchema = z.object({
	type: z.nativeEnum(GoalType),
	title: z.string().trim().min(1, "title is required"),
	description: z.string().trim().optional(),
	startValue: z.number(),
	currentValue: z.number(),
	targetValue: z.number(),
	unit: z.string().trim().min(1, "unit is required"),
	targetDate: z.string().datetime().optional(),
});

export const updateGoalSchema = createGoalSchema.partial().extend({
	status: z.nativeEnum(GoalStatus).optional(),
});

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
