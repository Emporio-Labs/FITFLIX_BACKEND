import z from "zod";
import { WorkoutSessionStatus } from "../models/Enums";

const exerciseInSessionSchema = z.object({
	exerciseId: z.string().min(1),
	targetSets: z.coerce.number().int().min(1).max(50),
	targetReps: z.coerce.number().int().min(1).max(100),
	targetWeightKg: z.coerce.number().min(0).max(999.99).optional(),
	restSeconds: z.coerce.number().int().min(0).max(600).optional().default(60),
});

export const createSessionBodySchema = z.object({
	date: z.coerce.date().optional(),
	notes: z.string().max(1000).optional(),
	exercises: z.array(exerciseInSessionSchema).optional().default([]),
	planId: z.string().optional().nullable(),
});

export const updateSessionBodySchema = z
	.object({
		status: z
			.enum(Object.values(WorkoutSessionStatus) as [string, ...string[]])
			.optional(),
		notes: z.string().max(1000).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const listSessionsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: z
		.enum(Object.values(WorkoutSessionStatus) as [string, ...string[]])
		.optional(),
});

export const addExerciseBodySchema = z.object({
	exerciseId: z.string().min(1),
	targetSets: z.coerce.number().int().min(1).max(50),
	targetReps: z.coerce.number().int().min(1).max(100),
	targetWeightKg: z.coerce.number().min(0).max(999.99).optional(),
	restSeconds: z.coerce.number().int().min(0).max(600).optional().default(60),
});

export const updateWorkoutExerciseBodySchema = z
	.object({
		targetSets: z.coerce.number().int().min(1).max(50).optional(),
		targetReps: z.coerce.number().int().min(1).max(100).optional(),
		targetWeightKg: z.coerce.number().min(0).max(999.99).optional(),
		restSeconds: z.coerce.number().int().min(0).max(600).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const reorderExercisesBodySchema = z.object({
	order: z.array(z.string().min(1)).min(1),
});

export const logSetBodySchema = z.object({
	actualReps: z.coerce.number().int().min(1).max(999),
	actualWeightKg: z.coerce.number().min(0).max(999.99),
	rpe: z.coerce.number().min(1).max(10).optional(),
	isWarmup: z.coerce.boolean().optional().default(false),
	notes: z.string().max(500).optional(),
});

export const updateSetBodySchema = z
	.object({
		actualReps: z.coerce.number().int().min(1).max(999).optional(),
		actualWeightKg: z.coerce.number().min(0).max(999.99).optional(),
		rpe: z.coerce.number().min(1).max(10).optional(),
		isWarmup: z.coerce.boolean().optional(),
		notes: z.string().max(500).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const historyQuerySchema = z.object({
	from: z.coerce.date().optional(),
	to: z.coerce.date().optional(),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});
