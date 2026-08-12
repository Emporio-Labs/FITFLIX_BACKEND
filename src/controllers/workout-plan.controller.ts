import fs from "node:fs";
import path from "node:path";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Admin from "../models/Admin";
import { PlanStatus } from "../models/Enums";
import User from "../models/User";
import WorkoutPlan from "../models/WorkoutPlan";
import { createAssignmentForUser } from "../services/planAssignment.service";
import { actorModelForRole } from "../utils/actor-model";
import {
	assignUsersBodySchema,
	createPlanBodySchema,
	listPlansQuerySchema,
	updatePlanBodySchema,
} from "../validators/workout-plan.validator";

const logValidationError = (
	endpoint: string,
	body: unknown,
	issues: unknown,
) => {
	try {
		const logPath = path.join(process.cwd(), "validation-errors.log");
		const logMessage = `[${new Date().toISOString()}] Endpoint: ${endpoint}\nBody: ${JSON.stringify(body, null, 2)}\nIssues: ${JSON.stringify(issues, null, 2)}\n\n`;
		fs.appendFileSync(logPath, logMessage);
		console.log(`[Validation Error Logged] ${endpoint}`);
	} catch (err) {
		console.error("Failed to write validation error to file:", err);
	}
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

export const createPlan: RequestHandler = async (req, res, next) => {
	try {
		const parsed = createPlanBodySchema.safeParse(req.body);
		if (!parsed.success) {
			logValidationError("POST /workout-plans", req.body, parsed.error.issues);
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const requester = req.user;
		if (!requester) {
			res.status(403).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const plan = await WorkoutPlan.create({
			...parsed.data,
			goal: parsed.data.goal as import("../models/Enums").PlanGoal,
			status: parsed.data.status as import("../models/Enums").PlanStatus,
			difficulty: parsed.data
				.difficulty as import("../models/Enums").ExerciseDifficulty,
			splitType: parsed.data.splitType as import("../models/Enums").SplitType,
			createdBy: requester.id,
			createdByModel: actorModelForRole(requester.role),
		});

		res.status(201).json(plan);
	} catch (error) {
		next(error);
	}
};

export const listPlans: RequestHandler = async (req, res, next) => {
	try {
		const parsed = listPlansQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const { page, limit, status, goal, difficulty, isTemplate, search } =
			parsed.data;
		const filter: Record<string, unknown> = {};

		if (status) filter.status = status;
		if (goal) filter.goal = goal;
		if (difficulty) filter.difficulty = difficulty;
		if (isTemplate) filter.isTemplate = isTemplate === "true";
		if (search) {
			const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			filter.name = { $regex: escaped, $options: "i" };
		}

		// Trainers see their own plans plus reusable templates, not the
		// full catalogue — admins are unrestricted.
		if (req.user?.role === "trainer") {
			filter.$or = [{ createdBy: req.user.id }, { isTemplate: true }];
		}

		const [plans, total] = await Promise.all([
			WorkoutPlan.find(filter)
				.sort({ updatedAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.populate("assignedUsers", "name email")
				.lean(),
			WorkoutPlan.countDocuments(filter),
		]);

		// Resolve creators manually: plans are created by Admins (separate
		// collection), so populate against the User ref would return null.
		const creatorIds = [
			...new Set(
				plans
					.map((p) => p.createdBy?.toString())
					.filter((id): id is string => Boolean(id)),
			),
		];
		const [creatorUsers, creatorAdmins] = await Promise.all([
			User.find({ _id: { $in: creatorIds } })
				.select("username email")
				.lean(),
			Admin.find({ _id: { $in: creatorIds } })
				.select("adminName email")
				.lean(),
		]);
		const creatorMap = new Map<string, unknown>();
		for (const u of creatorUsers) {
			creatorMap.set(u._id.toString(), {
				_id: u._id,
				name: u.username,
				email: u.email,
			});
		}
		for (const a of creatorAdmins) {
			creatorMap.set(a._id.toString(), {
				_id: a._id,
				name: a.adminName,
				email: a.email,
			});
		}
		const plansWithCreators = plans.map((p) => ({
			...p,
			createdBy: creatorMap.get(p.createdBy?.toString() ?? "") ?? p.createdBy,
		}));

		res.json({
			plans: plansWithCreators,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		next(error);
	}
};

export const getPlan: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({
				error: "Invalid plan ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const plan = await WorkoutPlan.findById(id)
			.populate("createdBy", "name email trainerName imageUrl specialities")
			.populate("assignedUsers", "name email")
			.populate(
				"days.exercises.exerciseId",
				"name muscleGroups difficulty equipment caloriesPerSet",
			)
			.lean();

		if (!plan) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		if (
			req.user?.role === "trainer" &&
			!plan.isTemplate &&
			(plan.createdBy as any)?._id?.toString() !== req.user.id &&
			(plan.createdBy as any)?.toString() !== req.user.id
		) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		// Transform populated exercises into { exerciseId: string, exercise: {...} } shape
		type ExerciseRef = {
			exerciseId: unknown;
			[key: string]: unknown;
		};
		type PlanDay = {
			exercises: ExerciseRef[];
			[key: string]: unknown;
		};
		const planWithDays = plan as typeof plan & { days: PlanDay[] };
		const transformed = {
			...plan,
			days: planWithDays.days.map((day) => ({
				...day,
				exercises: day.exercises.map((ex) => {
					const populated = ex.exerciseId as any;
					if (populated && typeof populated === "object" && populated._id) {
						const exercise = populated as {
							_id: { toString(): string };
							name: string;
							muscleGroups: string[] | undefined;
							difficulty: unknown;
							equipment: unknown;
							caloriesPerSet: unknown;
						};
						return {
							...ex,
							exerciseId: exercise._id.toString(),
							exercise: {
								name: exercise.name,
								// Flutter reads a singular `muscleGroup` string (see
								// lib/data/repository/workout_repository.dart
								// _parseExerciseEntity); take the first entry from
								// the schema's `muscleGroups` array.
								muscleGroup: exercise.muscleGroups?.[0] ?? "FullBody",
								difficulty: exercise.difficulty,
								equipment: exercise.equipment,
								caloriesPerSet: exercise.caloriesPerSet,
							},
						};
					}
					// populate() yields null when the Exercise document is gone,
					// leaving `exerciseId` as a bare ObjectId and no `exercise`.
					// Flag it so the builder can prompt for a replacement instead
					// of silently rendering a nameless row.
					return { ...ex, exerciseMissing: true };
				}),
			})),
		};

		res.json(transformed);
	} catch (error) {
		next(error);
	}
};

export const updatePlan: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({
				error: "Invalid plan ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const parsed = updatePlanBodySchema.safeParse(req.body);
		if (!parsed.success) {
			logValidationError(
				`PATCH /workout-plans/${id}`,
				req.body,
				parsed.error.issues,
			);
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const plan = await WorkoutPlan.findByIdAndUpdate(id, parsed.data, {
			new: true,
			runValidators: true,
		})
			.populate("createdBy", "name email trainerName imageUrl specialities")
			.populate("assignedUsers", "name email")
			.lean();

		if (!plan) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		res.json(plan);
	} catch (error) {
		next(error);
	}
};

export const deletePlan: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({
				error: "Invalid plan ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const plan = await WorkoutPlan.findById(id);
		if (!plan) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		// Templates can always be deleted (assignments hold their own copy of
		// the days, so removing a template never breaks assigned users).
		if (plan.status !== PlanStatus.Draft && !plan.isTemplate) {
			res.status(400).json({
				error: "Only draft plans or templates can be deleted",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		await plan.deleteOne();
		res.json({ message: "Plan deleted" });
	} catch (error) {
		next(error);
	}
};

// ── POST /workout-plans/:id/duplicate ─────────────────────────────────────────
// Creates a fresh Draft copy of a plan/template (source stays untouched).

export const duplicatePlan: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({
				error: "Invalid plan ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const createdBy = req.user?.id;
		if (!createdBy) {
			res.status(403).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const source = await WorkoutPlan.findById(id).lean();
		if (!source) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		const copy = await WorkoutPlan.create({
			name: `${source.name} (Copy)`,
			description: source.description,
			difficulty: source.difficulty,
			duration: source.duration,
			goal: source.goal,
			splitType: source.splitType,
			status: PlanStatus.Draft,
			isTemplate: false,
			templateCategory: null,
			createdBy,
			assignedUsers: [],
			days: source.days,
		});

		res.status(201).json(copy);
	} catch (error) {
		next(error);
	}
};

export const assignUsers: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({
				error: "Invalid plan ID",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const parsed = assignUsersBodySchema.safeParse(req.body);
		if (!parsed.success) {
			logValidationError(
				`POST /workout-plans/${id}/assign`,
				req.body,
				parsed.error.issues,
			);
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const planExists = await WorkoutPlan.exists({ _id: id });
		if (!planExists) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		const startDate = parsed.data.startDate
			? new Date(parsed.data.startDate)
			: new Date();
		const adminId = req.user?.id;
		if (!adminId || !req.user) {
			res.status(403).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		const assignedByModel = actorModelForRole(req.user.role);

		const results = await Promise.allSettled(
			parsed.data.userIds.map((uid) =>
				createAssignmentForUser({
					planId: id,
					userId: uid,
					assignedBy: adminId,
					assignedByModel,
					startDate,
				}),
			),
		);

		const created: string[] = [];
		const skipped: string[] = [];
		const failed: { userId: string; error: string }[] = [];

		results.forEach((r, i) => {
			const uid = parsed.data.userIds[i];
			if (!uid) return;
			if (r.status === "fulfilled") {
				if (r.value.created) created.push(uid);
				else skipped.push(uid);
			} else {
				const err =
					r.reason instanceof Error ? r.reason.message : String(r.reason);
				console.error(`assignUsers failed for ${uid}:`, err);
				failed.push({ userId: uid, error: err });
			}
		});

		// Keep plan.assignedUsers in sync so the admin grid keeps working without refactor.
		await WorkoutPlan.findByIdAndUpdate(id, {
			$addToSet: { assignedUsers: { $each: parsed.data.userIds } },
		});

		res.json({
			planId: id,
			startDate: startDate.toISOString(),
			created,
			skipped,
			failed,
		});
	} catch (error) {
		next(error);
	}
};
