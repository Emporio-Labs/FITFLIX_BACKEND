import z from "zod";
import {
	ExerciseDifficulty,
	PlanGoal,
	PlanStatus,
	SplitType,
} from "../models/Enums";

const planExerciseSchema = z.object({
	exerciseId: z.string().min(1),
	orderIndex: z.coerce.number().int().min(0),
	targetSets: z.coerce.number().int().min(1).max(50),
	targetReps: z.coerce.number().int().min(1).max(100),
	targetWeightKg: z.coerce.number().min(0).max(999.99).optional().default(0),
	restSeconds: z.coerce.number().int().min(0).max(600).optional().default(60),
});

const planDaySchema = z.object({
	dayNumber: z.coerce.number().int().min(1),
	name: z.string().min(1).max(100),
	isRestDay: z.boolean().optional().default(false),
	exercises: z.array(planExerciseSchema).optional().default([]),
});

export const createPlanBodySchema = z.object({
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional().default(""),
	difficulty: z.enum(
		Object.values(ExerciseDifficulty) as [string, ...string[]],
	),
	duration: z.coerce.number().int().min(1).max(52),
	goal: z.enum(Object.values(PlanGoal) as [string, ...string[]]),
	splitType: z
		.enum(Object.values(SplitType) as [string, ...string[]])
		.optional()
		.default(SplitType.Custom),
	status: z
		.enum(Object.values(PlanStatus) as [string, ...string[]])
		.optional()
		.default(PlanStatus.Draft),
	isTemplate: z.boolean().optional().default(false),
	templateCategory: z.string().max(100).optional(),
	assignedUsers: z.array(z.string().min(1)).optional().default([]),
	days: z.array(planDaySchema).optional().default([]),
});

export const updatePlanBodySchema = z
	.object({
		name: z.string().min(1).max(200).optional(),
		description: z.string().max(2000).optional(),
		difficulty: z
			.enum(Object.values(ExerciseDifficulty) as [string, ...string[]])
			.optional(),
		duration: z.coerce.number().int().min(1).max(52).optional(),
		goal: z
			.enum(Object.values(PlanGoal) as [string, ...string[]])
			.optional(),
		splitType: z
			.enum(Object.values(SplitType) as [string, ...string[]])
			.optional(),
		status: z
			.enum(Object.values(PlanStatus) as [string, ...string[]])
			.optional(),
		isTemplate: z.boolean().optional(),
		templateCategory: z.string().max(100).optional(),
		assignedUsers: z.array(z.string().min(1)).optional(),
		days: z.array(planDaySchema).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const listPlansQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: z
		.enum(Object.values(PlanStatus) as [string, ...string[]])
		.optional(),
	goal: z
		.enum(Object.values(PlanGoal) as [string, ...string[]])
		.optional(),
	difficulty: z
		.enum(Object.values(ExerciseDifficulty) as [string, ...string[]])
		.optional(),
});

export const assignUsersBodySchema = z.object({
	userIds: z.array(z.string().min(1)).min(1),
});
