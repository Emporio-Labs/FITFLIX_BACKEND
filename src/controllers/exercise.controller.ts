import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Exercise from "../models/Exercise";
import {
	createExerciseBodySchema,
	listExercisesQuerySchema,
	updateExerciseBodySchema,
} from "../validators/exercise.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

export const listExercises: RequestHandler = async (req, res, next) => {
	try {
		const parsed = listExercisesQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const { muscleGroup, difficulty, equipment, search, isSystem, page, limit } =
			parsed.data;

		const filter: Record<string, unknown> = {};

		if (typeof isSystem === "boolean") {
			if (isSystem) {
				filter.isSystem = true;
			} else {
				filter.isSystem = false;
				filter.createdBy = new mongoose.Types.ObjectId(req.user!.id);
			}
		} else {
			filter.$or = [
				{ isSystem: true },
				{ createdBy: new mongoose.Types.ObjectId(req.user!.id) },
			];
		}

		if (muscleGroup) filter.muscleGroup = muscleGroup;
		if (difficulty) filter.difficulty = difficulty;
		if (equipment) filter.equipment = { $regex: equipment, $options: "i" };
		if (search) filter.name = { $regex: search, $options: "i" };

		const [exercises, total] = await Promise.all([
			Exercise.find(filter)
				.sort({ isSystem: -1, name: 1 })
				.skip((page - 1) * limit)
				.limit(limit),
			Exercise.countDocuments(filter),
		]);

		res.status(200).json({
			exercises,
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

export const getExerciseById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const exercise = await Exercise.findById(id);
		if (!exercise) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (
			!exercise.isSystem &&
			exercise.createdBy?.toString() !== req.user!.id
		) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		res.status(200).json(exercise);
	} catch (error) {
		next(error);
	}
};

export const createExercise: RequestHandler = async (req, res, next) => {
	try {
		const parsed = createExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const exercise = await Exercise.create({
			...parsed.data,
			isSystem: false,
			createdBy: new mongoose.Types.ObjectId(req.user!.id),
		});

		res.status(201).json(exercise);
	} catch (error) {
		next(error);
	}
};

export const updateExercise: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const parsed = updateExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const exercise = await Exercise.findById(id);
		if (!exercise) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (exercise.isSystem) {
			res.status(403).json({ message: "Cannot modify a system exercise" });
			return;
		}

		if (exercise.createdBy?.toString() !== req.user!.id) {
			res.status(403).json({ message: "Not authorized to modify this exercise" });
			return;
		}

		const updated = await Exercise.findByIdAndUpdate(id, parsed.data, {
			new: true,
		});

		res.status(200).json(updated);
	} catch (error) {
		next(error);
	}
};

export const deleteExercise: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const exercise = await Exercise.findById(id);
		if (!exercise) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (exercise.isSystem) {
			res.status(403).json({ message: "Cannot delete a system exercise" });
			return;
		}

		if (exercise.createdBy?.toString() !== req.user!.id) {
			res.status(403).json({
				message: "Not authorized to delete this exercise",
			});
			return;
		}

		await Exercise.findByIdAndDelete(id);

		res.status(200).json({ message: "Exercise deleted" });
	} catch (error) {
		next(error);
	}
};
