import z from "zod";
import {
	ExerciseDifficulty,
	ExerciseSection,
	MuscleGroup,
} from "../models/Enums";

// The member app has shipped builds that send enum values in the wrong case
// (`difficulty: "beginner"`, `muscleGroup: "fullBody"`), a singular
// `muscleGroup` instead of `muscleGroups`, and `targetedMuscles: []`. Every one
// of those failed validation, so custom-exercise creation always 400'd. Those
// builds can't be recalled, so normalise the payload before validating instead
// of rejecting it.
const canonical = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");

const matchEnum = (values: string[], value: unknown) => {
	if (typeof value !== "string") return value;
	return values.find((v) => canonical(v) === canonical(value)) ?? value;
};

const matchEnumList = (values: string[], value: unknown) =>
	Array.isArray(value) ? value.map((v) => matchEnum(values, v)) : value;

const normalizeExercisePayload = (input: unknown) => {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const { muscleGroup, ...body } = input as Record<string, unknown>;
	if (body.muscleGroups === undefined && muscleGroup !== undefined) {
		body.muscleGroups = [muscleGroup];
	}
	if (body.muscleGroups !== undefined) {
		body.muscleGroups = matchEnumList(
			Object.values(MuscleGroup),
			body.muscleGroups,
		);
	}
	if (body.difficulty !== undefined) {
		body.difficulty = matchEnum(
			Object.values(ExerciseDifficulty),
			body.difficulty,
		);
	}
	if (body.sectionTypes !== undefined) {
		body.sectionTypes = matchEnumList(
			Object.values(ExerciseSection),
			body.sectionTypes,
		);
	}
	if (
		Array.isArray(body.targetedMuscles) &&
		body.targetedMuscles.length === 0
	) {
		delete body.targetedMuscles;
	}
	return body;
};

const normalizeListQuery = (input: unknown) => {
	if (!input || typeof input !== "object") return input;
	const query = { ...(input as Record<string, unknown>) };
	query.muscleGroup = matchEnum(Object.values(MuscleGroup), query.muscleGroup);
	query.difficulty = matchEnum(
		Object.values(ExerciseDifficulty),
		query.difficulty,
	);
	query.section = matchEnum(Object.values(ExerciseSection), query.section);
	return query;
};

export const listExercisesQuerySchema = z.preprocess(
	normalizeListQuery,
	z.object({
		muscleGroup: z
			.enum(Object.values(MuscleGroup) as [string, ...string[]])
			.optional(),
		difficulty: z
			.enum(Object.values(ExerciseDifficulty) as [string, ...string[]])
			.optional(),
		section: z
			.enum(Object.values(ExerciseSection) as [string, ...string[]])
			.optional(),
		equipment: z.string().optional(),
		search: z.string().optional(),
		isSystem: z
			.preprocess((val) => {
				if (val === "true") return true;
				if (val === "false") return false;
				return val;
			}, z.boolean())
			.optional(),
		page: z.coerce.number().int().min(1).default(1),
		limit: z.coerce.number().int().min(1).max(100).default(50),
	}),
);

export const createExerciseBodySchema = z.preprocess(
	normalizeExercisePayload,
	z.object({
		name: z.string().trim().min(1).max(100),
		muscleGroups: z
			.array(z.enum(Object.values(MuscleGroup) as [string, ...string[]]))
			.min(1)
			.default([]),
		targetedMuscles: z
			.array(z.string().trim().max(100))
			.min(1)
			.max(10)
			.optional()
			.default([]),
		difficulty: z.enum(
			Object.values(ExerciseDifficulty) as [string, ...string[]],
		),
		equipment: z.string().trim().min(1).max(200).optional().default(""),
		instructions: z.string().trim().max(5000).optional().default(""),
		commonMistakes: z
			.array(z.string().trim().max(500))
			.max(20)
			.optional()
			.default([]),
		tips: z.array(z.string().trim().max(500)).max(20).optional().default([]),
		caloriesPerSet: z.coerce
			.number()
			.int()
			.min(1)
			.max(1000)
			.optional()
			.default(0),
		sectionTypes: z
			.array(z.enum(Object.values(ExerciseSection) as [string, ...string[]]))
			.min(1)
			.max(3)
			.optional()
			.default(["workout"]),
		imageUrl: z.string().url().optional(),
	}),
);

export const updateExerciseBodySchema = z.preprocess(
	normalizeExercisePayload,
	z
		.object({
			name: z.string().trim().min(1).max(100).optional(),
			muscleGroups: z
				.array(z.enum(Object.values(MuscleGroup) as [string, ...string[]]))
				.min(1)
				.optional(),
			targetedMuscles: z
				.array(z.string().trim().max(100))
				.min(1)
				.max(10)
				.optional(),
			difficulty: z
				.enum(Object.values(ExerciseDifficulty) as [string, ...string[]])
				.optional(),
			equipment: z.string().trim().min(1).max(200).optional(),
			instructions: z.string().trim().max(5000).optional(),
			commonMistakes: z.array(z.string().trim().max(500)).max(20).optional(),
			tips: z.array(z.string().trim().max(500)).max(20).optional(),
			caloriesPerSet: z.coerce.number().int().min(1).max(1000).optional(),
			sectionTypes: z
				.array(z.enum(Object.values(ExerciseSection) as [string, ...string[]]))
				.min(1)
				.max(3)
				.optional(),
			imageUrl: z.string().url().optional(),
		})
		.refine((payload) => Object.keys(payload).length > 0, {
			message: "At least one field is required",
		}),
);

export type CreateExerciseBody = z.infer<typeof createExerciseBodySchema>;
export type UpdateExerciseBody = z.infer<typeof updateExerciseBodySchema>;
