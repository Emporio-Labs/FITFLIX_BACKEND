import { describe, expect, test } from "bun:test";
import {
	createExerciseBodySchema,
	listExercisesQuerySchema,
	updateExerciseBodySchema,
} from "../src/validators/exercise.validator";
import { looksLikeCardio } from "../src/utils/exercise-type";

describe("looksLikeCardio", () => {
	test.each([
		"Treadmill",
		"Treadmill Incline Walk",
		"StairMaster",
		"Stair Climber",
		"Step Mill",
		"Elliptical Trainer",
		"Cross Trainer",
		"Rowing Machine",
		"Rowing, Stationary",
		"Bicycling, Stationary",
		"Recumbent Bike",
		"Assault Bike",
		"Jogging, Treadmill",
		"Rope Jumping",
	])("%s is cardio", (name) => expect(looksLikeCardio(name)).toBe(true));

	test.each([
		"Bench Press",
		"Barbell Squat",
		"Bent Over Barbell Row",
		"Seated Cable Row",
		"Upright Row",
		"Running Man",
		"Plank",
	])("%s is not cardio", (name) => expect(looksLikeCardio(name)).toBe(false));
});

describe("exercise validators accept exerciseType", () => {
	const base = {
		name: "Treadmill",
		muscleGroups: ["Legs"],
		difficulty: "Beginner",
	};

	test("create defaults to strength", () => {
		const r = createExerciseBodySchema.safeParse(base);
		expect(r.success).toBe(true);
		expect(r.data?.exerciseType).toBe("strength");
	});

	test("create normalises case", () => {
		const r = createExerciseBodySchema.safeParse({ ...base, exerciseType: "Cardio" });
		expect(r.data?.exerciseType).toBe("cardio");
	});

	test("create rejects unknown types", () => {
		const r = createExerciseBodySchema.safeParse({ ...base, exerciseType: "yoga" });
		expect(r.success).toBe(false);
	});

	test("update can set it alone", () => {
		const r = updateExerciseBodySchema.safeParse({ exerciseType: "cardio" });
		expect(r.success).toBe(true);
	});

	test("list filters by it", () => {
		const r = listExercisesQuerySchema.safeParse({ exerciseType: "CARDIO" });
		expect(r.data?.exerciseType).toBe("cardio");
	});

	test("list ignores legacy dashboard values instead of failing", () => {
		const r = listExercisesQuerySchema.safeParse({ exerciseType: "Main" });
		expect(r.success).toBe(true);
		expect(r.data?.exerciseType).toBeUndefined();
	});
});
