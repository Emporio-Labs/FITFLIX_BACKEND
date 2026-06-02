import z from "zod";
import { ExerciseSection } from "../models/Enums";

const sectionEnum = z.enum(
	Object.values(ExerciseSection) as [string, ...string[]],
);

export const assignPlanBodySchema = z.object({
	startDate: z.coerce.date().optional(),
});

export const completePlanDayBodySchema = z.object({
	dayNumber: z.coerce.number().int().min(1),
	sessionId: z.string().min(1),
});

export const updateAssignmentDayBodySchema = z.object({
	exercises: z
		.array(
			z.object({
				exerciseId: z.string().min(1),
				orderIndex: z.coerce.number().int().min(0),
				section: sectionEnum.optional().default("workout"),
				targetSets: z.coerce.number().int().min(1).max(50),
				targetReps: z.coerce.number().int().min(1).max(100),
				targetWeightKg: z.coerce
					.number()
					.min(0)
					.max(999.99)
					.optional()
					.default(0),
				restSeconds: z.coerce
					.number()
					.int()
					.min(0)
					.max(600)
					.optional()
					.default(60),
				durationSeconds: z.coerce.number().int().min(1).max(86400).optional(),
			}),
		)
		.min(1),
});

export const scheduleQuerySchema = z.object({
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
});
