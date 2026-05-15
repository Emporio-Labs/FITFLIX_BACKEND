import type { RequestHandler } from "express";
import mongoose from "mongoose";
import WorkoutPlan from "../models/WorkoutPlan";
import { PlanStatus } from "../models/Enums";
import {
	assignUsersBodySchema,
	createPlanBodySchema,
	listPlansQuerySchema,
	updatePlanBodySchema,
} from "../validators/workout-plan.validator";

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
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const plan = await WorkoutPlan.create({
			...parsed.data,
			createdBy: req.user!.id,
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

		const { page, limit, status, goal, difficulty } = parsed.data;
		const filter: Record<string, unknown> = {};

		if (status) filter.status = status;
		if (goal) filter.goal = goal;
		if (difficulty) filter.difficulty = difficulty;

		const [plans, total] = await Promise.all([
			WorkoutPlan.find(filter)
				.sort({ updatedAt: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.populate("createdBy", "name email")
				.populate("assignedUsers", "name email")
				.lean(),
			WorkoutPlan.countDocuments(filter),
		]);

		res.json({
			plans,
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
			.populate("createdBy", "name email")
			.populate("assignedUsers", "name email")
			.populate("days.exercises.exerciseId", "name muscleGroup difficulty equipment caloriesPerSet")
			.lean();

		if (!plan) {
			res.status(404).json({ error: "Plan not found" });
			return;
		}

		// Transform populated exercises into { exerciseId: string, exercise: {...} } shape
		const transformed = {
			...plan,
			days: (plan as any).days.map((day: any) => ({
				...day,
				exercises: day.exercises.map((ex: any) => {
					const populated = ex.exerciseId;
					if (populated && typeof populated === "object" && populated._id) {
						return {
							...ex,
							exerciseId: populated._id.toString(),
							exercise: {
								name: populated.name,
								muscleGroup: populated.muscleGroup,
								difficulty: populated.difficulty,
								equipment: populated.equipment,
								caloriesPerSet: populated.caloriesPerSet,
							},
						};
					}
					return ex;
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
			.populate("createdBy", "name email")
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

		if (plan.status !== PlanStatus.Draft) {
			res.status(400).json({
				error: "Only draft plans can be deleted",
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
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const plan = await WorkoutPlan.findByIdAndUpdate(
			id,
			{ assignedUsers: parsed.data.userIds },
			{ new: true, runValidators: true },
		)
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
