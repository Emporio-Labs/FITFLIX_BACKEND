import type { RequestHandler } from "express";
import mongoose from "mongoose";
import type {
	ExerciseDifficulty,
	PlanGoal,
	PlanStatus,
	SplitType,
} from "../models/Enums";
import Exercise from "../models/Exercise";
import WorkoutPlan from "../models/WorkoutPlan";
import type { AuthenticatedUser } from "../types/auth";
import { actorModelForRole } from "../utils/actor-model";
import {
	buildWorkoutPlanTemplate,
	type ImportIssue,
	type LibraryExercise,
	type ParsedPlan,
	parseWorkoutPlanWorkbook,
	WORKOUT_SHEET,
} from "../utils/workout-plan-excel";
import { createPlanBodySchema } from "../validators/workout-plan.validator";

/**
 * Same visibility as the exercise picker (GET /exercises): system exercises
 * plus the requester's own, never soft-deleted ones.
 */
const loadVisibleExercises = async (
	requester: AuthenticatedUser,
): Promise<LibraryExercise[]> => {
	const or: Record<string, unknown>[] = [{ isSystem: true }];
	if (mongoose.Types.ObjectId.isValid(requester.id)) {
		or.push({ createdBy: new mongoose.Types.ObjectId(requester.id) });
	}
	const rows = await Exercise.find({ isDeleted: { $ne: true }, $or: or })
		.select("name muscleGroups equipment difficulty sectionTypes isSystem")
		.lean();
	return rows.map((e) => ({
		_id: e._id.toString(),
		name: e.name,
		muscleGroups: e.muscleGroups ?? [],
		equipment: e.equipment ?? "",
		difficulty: e.difficulty,
		sectionTypes: e.sectionTypes ?? [],
		isSystem: Boolean(e.isSystem),
	}));
};

const toCreateBody = (plan: ParsedPlan) => ({
	...plan,
	days: plan.days.map((d) => ({
		...d,
		exercises: d.exercises.map(({ exerciseName: _name, ...ex }) => ex),
	})),
});

const summarize = (plan: ParsedPlan) => ({
	days: plan.days.length,
	trainingDays: plan.days.filter((d) => !d.isRestDay).length,
	restDays: plan.days.filter((d) => d.isRestDay).length,
	exercises: plan.days.reduce((n, d) => n + d.exercises.length, 0),
});

export const downloadWorkoutPlanTemplate: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		if (!req.user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		const buffer = buildWorkoutPlanTemplate(
			await loadVisibleExercises(req.user),
		);
		res.setHeader(
			"Content-Type",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		res.setHeader(
			"Content-Disposition",
			'attachment; filename="workout-plan-template.xlsx"',
		);
		res.send(buffer);
	} catch (error) {
		next(error);
	}
};

/**
 * POST /workout-plans/import  (multipart, field `file`)
 *
 * `?dryRun=true` parses and validates only, always answering 200 with
 * `{ valid, plan, errors, warnings, summary }` so the UI can show a preview.
 * Without it, a clean file creates the plan (201); a file with errors is
 * rejected with 400 and the list under `details.errors` — the app-wide 4xx
 * normaliser keeps only `{ error, code, details }`.
 */
export const importWorkoutPlan: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!req.file?.buffer) {
			res.status(400).json({
				error: 'Attach the Excel file as multipart field "file"',
				code: "VALIDATION_ERROR",
			});
			return;
		}
		const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";

		const { plan, errors, warnings } = parseWorkoutPlanWorkbook(
			req.file.buffer,
			await loadVisibleExercises(requester),
		);

		// Final gate: the exact schema POST /workout-plans uses. The parser
		// already enforces these rules, so a hit here means the two drifted.
		let body: ReturnType<typeof createPlanBodySchema.parse> | null = null;
		if (plan && errors.length === 0) {
			const parsed = createPlanBodySchema.safeParse(toCreateBody(plan));
			if (parsed.success) {
				body = parsed.data;
			} else {
				errors.push(
					...parsed.error.issues.map(
						(issue): ImportIssue => ({
							sheet: WORKOUT_SHEET,
							message: `${issue.path.map(String).join(".")}: ${issue.message}`,
						}),
					),
				);
			}
		}

		const valid = errors.length === 0 && body !== null;
		const summary = plan ? summarize(plan) : null;

		if (dryRun) {
			res.json({ valid, plan, errors, warnings, summary });
			return;
		}

		if (!valid || !body) {
			res.status(400).json({
				error: `The file has ${errors.length} problem${errors.length === 1 ? "" : "s"} — fix them and upload again`,
				code: "VALIDATION_ERROR",
				details: { errors, warnings },
			});
			return;
		}

		const created = await WorkoutPlan.create({
			...body,
			goal: body.goal as PlanGoal,
			status: body.status as PlanStatus,
			difficulty: body.difficulty as ExerciseDifficulty,
			splitType: body.splitType as SplitType,
			createdBy: requester.id,
			createdByModel: actorModelForRole(requester.role),
		});

		res.status(201).json({
			message: `Workout plan "${created.name}" imported`,
			plan: created,
			warnings,
			summary,
		});
	} catch (error) {
		next(error);
	}
};
