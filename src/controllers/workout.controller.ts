import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Exercise from "../models/Exercise";
import { WorkoutSessionStatus } from "../models/Enums";
import SetLog from "../models/SetLog";
import WorkoutExercise from "../models/WorkoutExercise";
import WorkoutSession from "../models/WorkoutSession";
import {
	addExerciseBodySchema,
	createSessionBodySchema,
	historyQuerySchema,
	listSessionsQuerySchema,
	logSetBodySchema,
	reorderExercisesBodySchema,
	updateSessionBodySchema,
	updateSetBodySchema,
	updateWorkoutExerciseBodySchema,
} from "../validators/workout.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const buildSessionWithDetails = async (sessionId: mongoose.Types.ObjectId) => {
	const session = await WorkoutSession.findById(sessionId).lean();
	if (!session) return null;

	const workoutExercises = await WorkoutExercise.find({
		sessionId: session._id,
	})
		.sort({ orderIndex: 1 })
		.lean();

	const exerciseIds = workoutExercises.map((we) => we.exerciseId);
	const exercises = await Exercise.find({ _id: { $in: exerciseIds } }).lean();
	const exerciseMap = new Map(
		exercises.map((e) => [e._id.toString(), e]),
	);

	const workoutExerciseIds = workoutExercises.map((we) => we._id);
	const setLogs = await SetLog.find({
		workoutExerciseId: { $in: workoutExerciseIds },
	})
		.sort({ setNumber: 1 })
		.lean();

	const setLogsByExercise = new Map<string, typeof setLogs>();
	for (const log of setLogs) {
		const key = log.workoutExerciseId.toString();
		if (!setLogsByExercise.has(key)) {
			setLogsByExercise.set(key, []);
		}
		setLogsByExercise.get(key)!.push(log);
	}

	const exercisesWithSets = workoutExercises.map((we) => {
		const exercise = exerciseMap.get(we.exerciseId.toString());
		return {
			...we,
			exercise: exercise
				? {
						name: exercise.name,
						muscleGroup: exercise.muscleGroup,
						difficulty: exercise.difficulty,
						equipment: exercise.equipment,
						caloriesPerSet: exercise.caloriesPerSet,
					}
				: null,
			sets: setLogsByExercise.get(we._id.toString()) || [],
		};
	});

	return { ...session, exercises: exercisesWithSets };
};

// ─── Session Handlers ────────────────────────────────────────────────────────

export const getTodaySession: RequestHandler = async (req, res, next) => {
	try {
		const today = normalizeToUtcDate(new Date());
		const userId = new mongoose.Types.ObjectId(req.user!.id);

		let session = await WorkoutSession.findOne({
			userId,
			date: today,
			status: WorkoutSessionStatus.Active,
		});

		if (!session) {
			session = await WorkoutSession.create({
				userId,
				date: today,
				status: WorkoutSessionStatus.Active,
				startedAt: new Date(),
			});
		}

		const detailed = await buildSessionWithDetails(session._id);
		res.status(200).json(detailed);
	} catch (error) {
		next(error);
	}
};

export const listMySessions: RequestHandler = async (req, res, next) => {
	try {
		const parsed = listSessionsQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const { page, limit, status } = parsed.data;
		const userId = new mongoose.Types.ObjectId(req.user!.id);

		const filter: Record<string, unknown> = { userId };
		if (status) filter.status = status;

		const [sessions, total] = await Promise.all([
			WorkoutSession.find(filter)
				.sort({ date: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
			WorkoutSession.countDocuments(filter),
		]);

		res.status(200).json({
			sessions,
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

export const getSessionById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid session ID" });
			return;
		}

		const session = await WorkoutSession.findById(id);
		if (!session) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		if (session.userId.toString() !== req.user!.id) {
			res.status(403).json({ message: "Not authorized" });
			return;
		}

		const detailed = await buildSessionWithDetails(session._id);
		res.status(200).json(detailed);
	} catch (error) {
		next(error);
	}
};

export const createSession: RequestHandler = async (req, res, next) => {
	try {
		const parsed = createSessionBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const userId = new mongoose.Types.ObjectId(req.user!.id);
		const date = normalizeToUtcDate(parsed.data.date || new Date());

		const existing = await WorkoutSession.findOne({
			userId,
			date,
			status: WorkoutSessionStatus.Active,
		});

		if (existing) {
			const detailed = await buildSessionWithDetails(existing._id);
			res.status(200).json(detailed);
			return;
		}

		const session = await WorkoutSession.create({
			userId,
			date,
			status: WorkoutSessionStatus.Active,
			startedAt: new Date(),
			notes: parsed.data.notes || null,
			planId: parsed.data.planId ? new mongoose.Types.ObjectId(parsed.data.planId) : null,
		});

		let exercisesToAdd = parsed.data.exercises;

		if (parsed.data.planId) {
			const plan = await mongoose.model("WorkoutPlan").findById(parsed.data.planId);
			if (!plan) {
				res.status(404).json({ error: "Plan not found" });
				return;
			}

			const isAssigned = (plan as any).assignedUsers.some(
				(id: any) => id.toString() === userId.toString(),
			);
			const isCreator = (plan as any).createdBy.toString() === userId.toString();

			if (!isAssigned && !isCreator) {
				res.status(403).json({ error: "Not authorized to use this plan" });
				return;
			}

			if ((plan as any).days && (plan as any).days.length > 0) {
				const firstDay = (plan as any).days[0];
				exercisesToAdd = firstDay.exercises.map((planEx: any) => ({
					exerciseId: planEx.exerciseId.toString(),
					targetSets: planEx.targetSets,
					targetReps: planEx.targetReps,
					targetWeightKg: planEx.targetWeightKg,
					restSeconds: planEx.restSeconds,
				}));
			}
		}

		if (exercisesToAdd.length > 0) {
			const exerciseIds = exercisesToAdd.map((e) => e.exerciseId);
			const validExercises = await Exercise.find({
				_id: { $in: exerciseIds },
				$or: [{ isSystem: true }, { createdBy: userId }],
			});
			const validIds = new Set(
				validExercises.map((e) => e._id.toString()),
			);

			const workoutExercises = exercisesToAdd
				.filter((e) => validIds.has(e.exerciseId))
				.map((e, index) => ({
					sessionId: session._id,
					exerciseId: new mongoose.Types.ObjectId(e.exerciseId),
					orderIndex: index,
					targetSets: e.targetSets,
					targetReps: e.targetReps,
					targetWeightKg: e.targetWeightKg ?? null,
					restSeconds: e.restSeconds,
				}));

			if (workoutExercises.length > 0) {
				await WorkoutExercise.insertMany(workoutExercises);
			}
		}

		const detailed = await buildSessionWithDetails(session._id);
		res.status(201).json(detailed);
	} catch (error) {
		next(error);
	}
};

export const updateSession: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid session ID" });
			return;
		}

		const parsed = updateSessionBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(id);
		if (!session) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		if (session.userId.toString() !== req.user!.id) {
			res.status(403).json({ message: "Not authorized" });
			return;
		}

		if (
			session.status === WorkoutSessionStatus.Completed &&
			parsed.data.status === WorkoutSessionStatus.Active
		) {
			res.status(409).json({ message: "Cannot reactivate a completed session" });
			return;
		}

		const update: Record<string, unknown> = { ...parsed.data };
		if (parsed.data.status === WorkoutSessionStatus.Completed) {
			update.completedAt = new Date();
		}

		const updated = await WorkoutSession.findByIdAndUpdate(id, update, {
			new: true,
		});

		res.status(200).json(updated);
	} catch (error) {
		next(error);
	}
};

export const deleteSession: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid session ID" });
			return;
		}

		const session = await WorkoutSession.findById(id);
		if (!session) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		if (session.userId.toString() !== req.user!.id) {
			res.status(403).json({ message: "Not authorized" });
			return;
		}

		if (session.status !== WorkoutSessionStatus.Active) {
			res.status(409).json({ message: "Can only delete active sessions" });
			return;
		}

		const workoutExercises = await WorkoutExercise.find({
			sessionId: session._id,
		});
		const workoutExerciseIds = workoutExercises.map((we) => we._id);

		const setCount = await SetLog.countDocuments({
			workoutExerciseId: { $in: workoutExerciseIds },
		});

		if (setCount > 0) {
			res.status(409).json({
				message: "Cannot delete a session with logged sets",
			});
			return;
		}

		await WorkoutExercise.deleteMany({ sessionId: session._id });
		await WorkoutSession.findByIdAndDelete(id);

		res.status(200).json({ message: "Workout session deleted" });
	} catch (error) {
		next(error);
	}
};

// ─── Exercise-in-Session Handlers ────────────────────────────────────────────

export const addExerciseToSession: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		if (!sessionId) {
			res.status(400).json({ message: "Invalid session ID" });
			return;
		}

		const parsed = addExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		if (session.status !== WorkoutSessionStatus.Active) {
			res.status(409).json({ message: "Session is not active" });
			return;
		}

		const exerciseId = getIdParam(parsed.data.exerciseId);
		if (!exerciseId) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const exercise = await Exercise.findOne({
			_id: exerciseId,
			$or: [
				{ isSystem: true },
				{ createdBy: new mongoose.Types.ObjectId(req.user!.id) },
			],
		});

		if (!exercise) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		const maxOrder = await WorkoutExercise.findOne({ sessionId: session._id })
			.sort({ orderIndex: -1 })
			.select("orderIndex")
			.lean();

		const workoutExercise = await WorkoutExercise.create({
			sessionId: session._id,
			exerciseId: exercise._id,
			orderIndex: maxOrder ? maxOrder.orderIndex + 1 : 0,
			targetSets: parsed.data.targetSets,
			targetReps: parsed.data.targetReps,
			targetWeightKg: parsed.data.targetWeightKg ?? null,
			restSeconds: parsed.data.restSeconds,
		});

		res.status(201).json(workoutExercise);
	} catch (error) {
		next(error);
	}
};

export const updateWorkoutExercise: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		const id = getIdParam(req.params.id);
		if (!sessionId || !id) {
			res.status(400).json({ message: "Invalid ID" });
			return;
		}

		const parsed = updateWorkoutExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		const workoutExercise = await WorkoutExercise.findOneAndUpdate(
			{ _id: id, sessionId: session._id },
			parsed.data,
			{ new: true },
		);

		if (!workoutExercise) {
			res.status(404).json({ message: "Workout exercise not found" });
			return;
		}

		res.status(200).json(workoutExercise);
	} catch (error) {
		next(error);
	}
};

export const deleteWorkoutExercise: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		const id = getIdParam(req.params.id);
		if (!sessionId || !id) {
			res.status(400).json({ message: "Invalid ID" });
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		const workoutExercise = await WorkoutExercise.findOne({
			_id: id,
			sessionId: session._id,
		});

		if (!workoutExercise) {
			res.status(404).json({ message: "Workout exercise not found" });
			return;
		}

		await SetLog.deleteMany({ workoutExerciseId: workoutExercise._id });
		await WorkoutExercise.findByIdAndDelete(id);

		res.status(200).json({ message: "Exercise removed from session" });
	} catch (error) {
		next(error);
	}
};

export const reorderExercises: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		if (!sessionId) {
			res.status(400).json({ message: "Invalid session ID" });
			return;
		}

		const parsed = reorderExercisesBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		const ops = parsed.data.order.map((exerciseId, index) => ({
			updateOne: {
				filter: {
					_id: new mongoose.Types.ObjectId(exerciseId),
					sessionId: session._id,
				},
				update: { $set: { orderIndex: index } },
			},
		}));

		await WorkoutExercise.bulkWrite(ops);

		const updated = await WorkoutExercise.find({ sessionId: session._id })
			.sort({ orderIndex: 1 })
			.lean();

		res.status(200).json(updated);
	} catch (error) {
		next(error);
	}
};

// ─── Set Logging Handlers ────────────────────────────────────────────────────

export const logSet: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		const exerciseId = getIdParam(req.params.exerciseId);
		if (!sessionId || !exerciseId) {
			res.status(400).json({ message: "Invalid ID" });
			return;
		}

		const parsed = logSetBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		if (session.status !== WorkoutSessionStatus.Active) {
			res.status(409).json({ message: "Session is not active" });
			return;
		}

		const workoutExercise = await WorkoutExercise.findOne({
			_id: exerciseId,
			sessionId: session._id,
		});

		if (!workoutExercise) {
			res.status(404).json({ message: "Workout exercise not found" });
			return;
		}

		const currentSetCount = await SetLog.countDocuments({
			workoutExerciseId: workoutExercise._id,
		});

		const setLog = await SetLog.create({
			workoutExerciseId: workoutExercise._id,
			setNumber: currentSetCount + 1,
			actualReps: parsed.data.actualReps,
			actualWeightKg: parsed.data.actualWeightKg,
			rpe: parsed.data.rpe ?? null,
			isWarmup: parsed.data.isWarmup,
			completedAt: new Date(),
			notes: parsed.data.notes ?? null,
		});

		const nonWarmupCount = await SetLog.countDocuments({
			workoutExerciseId: workoutExercise._id,
			isWarmup: false,
		});

		const exerciseCompleted = nonWarmupCount >= workoutExercise.targetSets;
		const setsRemaining = Math.max(
			0,
			workoutExercise.targetSets - nonWarmupCount,
		);

		if (exerciseCompleted && !workoutExercise.isCompleted) {
			await WorkoutExercise.findByIdAndUpdate(workoutExercise._id, {
				isCompleted: true,
			});
		}

		res.status(201).json({
			...setLog.toObject(),
			exerciseCompleted,
			setsRemaining,
		});
	} catch (error) {
		next(error);
	}
};

export const updateSet: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		const exerciseId = getIdParam(req.params.exerciseId);
		const setId = getIdParam(req.params.setId);
		if (!sessionId || !exerciseId || !setId) {
			res.status(400).json({ message: "Invalid ID" });
			return;
		}

		const parsed = updateSetBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		const workoutExercise = await WorkoutExercise.findOne({
			_id: exerciseId,
			sessionId: session._id,
		});

		if (!workoutExercise) {
			res.status(404).json({ message: "Workout exercise not found" });
			return;
		}

		const setLog = await SetLog.findOneAndUpdate(
			{ _id: setId, workoutExerciseId: workoutExercise._id },
			parsed.data,
			{ new: true },
		);

		if (!setLog) {
			res.status(404).json({ message: "Set not found" });
			return;
		}

		res.status(200).json(setLog);
	} catch (error) {
		next(error);
	}
};

export const deleteSet: RequestHandler = async (req, res, next) => {
	try {
		const sessionId = getIdParam(req.params.sessionId);
		const exerciseId = getIdParam(req.params.exerciseId);
		const setId = getIdParam(req.params.setId);
		if (!sessionId || !exerciseId || !setId) {
			res.status(400).json({ message: "Invalid ID" });
			return;
		}

		const session = await WorkoutSession.findById(sessionId);
		if (!session || session.userId.toString() !== req.user!.id) {
			res.status(404).json({ message: "Workout session not found" });
			return;
		}

		const workoutExercise = await WorkoutExercise.findOne({
			_id: exerciseId,
			sessionId: session._id,
		});

		if (!workoutExercise) {
			res.status(404).json({ message: "Workout exercise not found" });
			return;
		}

		const setLog = await SetLog.findOneAndDelete({
			_id: setId,
			workoutExerciseId: workoutExercise._id,
		});

		if (!setLog) {
			res.status(404).json({ message: "Set not found" });
			return;
		}

		// Renumber remaining sets
		const remainingSets = await SetLog.find({
			workoutExerciseId: workoutExercise._id,
		}).sort({ setNumber: 1 });

		const renumberOps = remainingSets.map((s, index) => ({
			updateOne: {
				filter: { _id: s._id },
				update: { $set: { setNumber: index + 1 } },
			},
		}));

		if (renumberOps.length > 0) {
			await SetLog.bulkWrite(renumberOps);
		}

		// Recalculate isCompleted
		const nonWarmupCount = await SetLog.countDocuments({
			workoutExerciseId: workoutExercise._id,
			isWarmup: false,
		});

		const isCompleted = nonWarmupCount >= workoutExercise.targetSets;
		if (workoutExercise.isCompleted !== isCompleted) {
			await WorkoutExercise.findByIdAndUpdate(workoutExercise._id, {
				isCompleted,
			});
		}

		res.status(200).json({ message: "Set deleted" });
	} catch (error) {
		next(error);
	}
};

// ─── Stats & History Handlers ────────────────────────────────────────────────

export const getMyStats: RequestHandler = async (req, res, next) => {
	try {
		const userId = new mongoose.Types.ObjectId(req.user!.id);
		const now = new Date();

		// Current week (Monday-Sunday)
		const dayOfWeek = now.getUTCDay();
		const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
		const weekStart = normalizeToUtcDate(
			new Date(now.getTime() - mondayOffset * 86400000),
		);
		const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);

		// Weekly completed sessions
		const weeklyWorkouts = await WorkoutSession.countDocuments({
			userId,
			status: WorkoutSessionStatus.Completed,
			date: { $gte: weekStart, $lt: weekEnd },
		});

		// Get all workout exercises for this week's completed sessions
		const weekSessions = await WorkoutSession.find({
			userId,
			status: WorkoutSessionStatus.Completed,
			date: { $gte: weekStart, $lt: weekEnd },
		})
			.select("_id")
			.lean();

		const weekSessionIds = weekSessions.map((s) => s._id);

		const weekExercises = await WorkoutExercise.find({
			sessionId: { $in: weekSessionIds },
		}).lean();

		const weekExerciseIds = weekExercises.map((we) => we._id);

		// Total non-warmup sets this week
		const weekSets = await SetLog.find({
			workoutExerciseId: { $in: weekExerciseIds },
			isWarmup: false,
		}).lean();

		const totalSetsThisWeek = weekSets.length;

		// Total volume this week
		let totalVolumeKg = 0;
		for (const set of weekSets) {
			totalVolumeKg += set.actualWeightKg * set.actualReps;
		}

		// Calories burned this week
		const exerciseIds = [
			...new Set(weekExercises.map((we) => we.exerciseId.toString())),
		];
		const exerciseDocs = await Exercise.find({
			_id: { $in: exerciseIds },
		})
			.select("_id caloriesPerSet")
			.lean();

		const caloriesMap = new Map(
			exerciseDocs.map((e) => [e._id.toString(), e.caloriesPerSet]),
		);

		const exerciseIdByWorkoutExercise = new Map(
			weekExercises.map((we) => [
				we._id.toString(),
				we.exerciseId.toString(),
			]),
		);

		let caloriesBurnedWeek = 0;
		for (const set of weekSets) {
			const exId = exerciseIdByWorkoutExercise.get(
				set.workoutExerciseId.toString(),
			);
			if (exId) {
				caloriesBurnedWeek += caloriesMap.get(exId) ?? 0;
			}
		}

		// Current streak (consecutive days with completed session)
		let currentStreak = 0;
		let checkDate = normalizeToUtcDate(now);

		while (true) {
			const hasSession = await WorkoutSession.exists({
				userId,
				status: WorkoutSessionStatus.Completed,
				date: checkDate,
			});

			if (!hasSession) break;
			currentStreak++;
			checkDate = new Date(checkDate.getTime() - 86400000);
		}

		// Consistency score (completed / 7 days * 4 weeks)
		const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
		const completedInFourWeeks = await WorkoutSession.countDocuments({
			userId,
			status: WorkoutSessionStatus.Completed,
			date: { $gte: normalizeToUtcDate(fourWeeksAgo) },
		});
		const consistencyScore = Math.min(1, completedInFourWeeks / 28);

		// Personal records (max weight per exercise)
		const allCompletedSessions = await WorkoutSession.find({
			userId,
			status: WorkoutSessionStatus.Completed,
		})
			.select("_id")
			.lean();

		const allSessionIds = allCompletedSessions.map((s) => s._id);
		const allWorkoutExercises = await WorkoutExercise.find({
			sessionId: { $in: allSessionIds },
		}).lean();

		const allWorkoutExerciseIds = allWorkoutExercises.map((we) => we._id);

		const prPipeline = [
			{
				$match: {
					workoutExerciseId: { $in: allWorkoutExerciseIds },
					isWarmup: false,
				},
			},
			{
				$lookup: {
					from: "workoutexercises",
					localField: "workoutExerciseId",
					foreignField: "_id",
					as: "workoutExercise",
				},
			},
			{ $unwind: "$workoutExercise" },
			{
				$lookup: {
					from: "exercises",
					localField: "workoutExercise.exerciseId",
					foreignField: "_id",
					as: "exercise",
				},
			},
			{ $unwind: "$exercise" },
			{
				$group: {
					_id: "$exercise._id",
					name: { $first: "$exercise.name" },
					maxWeightKg: { $max: "$actualWeightKg" },
					maxReps: { $max: "$actualReps" },
					achievedAt: { $last: "$completedAt" },
				},
			},
		];

		const prResults = await SetLog.aggregate(prPipeline);
		const personalRecords: Record<
			string,
			{ maxWeightKg: number; maxReps: number; achievedAt: Date }
		> = {};
		for (const pr of prResults) {
			const key = (pr.name as string)
				.replace(/\s+/g, "")
				.replace(/^./, (c: string) => c.toLowerCase());
			personalRecords[key] = {
				maxWeightKg: pr.maxWeightKg,
				maxReps: pr.maxReps,
				achievedAt: pr.achievedAt,
			};
		}

		res.status(200).json({
			weeklyWorkouts,
			totalSetsThisWeek,
			caloriesBurnedWeek,
			consistencyScore: Math.round(consistencyScore * 100) / 100,
			currentStreak,
			totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
			personalRecords,
		});
	} catch (error) {
		next(error);
	}
};

export const getMyHistory: RequestHandler = async (req, res, next) => {
	try {
		const parsed = historyQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const userId = new mongoose.Types.ObjectId(req.user!.id);
		const { page, limit } = parsed.data;
		const now = new Date();
		const from = parsed.data.from || new Date(now.getTime() - 30 * 86400000);
		const to = parsed.data.to || now;

		const filter = {
			userId,
			status: WorkoutSessionStatus.Completed,
			date: { $gte: normalizeToUtcDate(from), $lte: normalizeToUtcDate(to) },
		};

		const [sessions, total] = await Promise.all([
			WorkoutSession.find(filter)
				.sort({ date: -1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
			WorkoutSession.countDocuments(filter),
		]);

		const sessionIds = sessions.map((s) => s._id);
		const workoutExercises = await WorkoutExercise.find({
			sessionId: { $in: sessionIds },
		}).lean();

		const workoutExerciseIds = workoutExercises.map((we) => we._id);
		const setLogs = await SetLog.find({
			workoutExerciseId: { $in: workoutExerciseIds },
			isWarmup: false,
		}).lean();

		const exerciseIds = [
			...new Set(workoutExercises.map((we) => we.exerciseId.toString())),
		];
		const exerciseDocs = await Exercise.find({
			_id: { $in: exerciseIds },
		})
			.select("_id caloriesPerSet muscleGroup")
			.lean();

		const exerciseInfoMap = new Map(
			exerciseDocs.map((e) => [
				e._id.toString(),
				{ caloriesPerSet: e.caloriesPerSet, muscleGroup: e.muscleGroup },
			]),
		);

		// Group data by session
		const exercisesBySession = new Map<string, typeof workoutExercises>();
		for (const we of workoutExercises) {
			const key = we.sessionId.toString();
			if (!exercisesBySession.has(key)) exercisesBySession.set(key, []);
			exercisesBySession.get(key)!.push(we);
		}

		const setsByWorkoutExercise = new Map<string, typeof setLogs>();
		for (const sl of setLogs) {
			const key = sl.workoutExerciseId.toString();
			if (!setsByWorkoutExercise.has(key))
				setsByWorkoutExercise.set(key, []);
			setsByWorkoutExercise.get(key)!.push(sl);
		}

		const workouts = sessions.map((session) => {
			const sessionExercises =
				exercisesBySession.get(session._id.toString()) || [];
			let totalSets = 0;
			let totalReps = 0;
			let totalVolumeKg = 0;
			let caloriesBurned = 0;
			const muscleGroups = new Set<string>();

			for (const we of sessionExercises) {
				const sets =
					setsByWorkoutExercise.get(we._id.toString()) || [];
				const info = exerciseInfoMap.get(we.exerciseId.toString());

				totalSets += sets.length;
				for (const s of sets) {
					totalReps += s.actualReps;
					totalVolumeKg += s.actualWeightKg * s.actualReps;
					if (info) caloriesBurned += info.caloriesPerSet;
				}
				if (info) muscleGroups.add(info.muscleGroup);
			}

			const duration =
				session.completedAt && session.startedAt
					? Math.round(
							(new Date(session.completedAt).getTime() -
								new Date(session.startedAt).getTime()) /
								1000,
						)
					: 0;

			return {
				id: session._id,
				date: session.date,
				status: session.status,
				duration,
				exerciseCount: sessionExercises.length,
				totalSets,
				totalReps,
				totalVolumeKg: Math.round(totalVolumeKg * 100) / 100,
				caloriesBurned,
				muscleGroups: [...muscleGroups],
			};
		});

		res.status(200).json({
			workouts,
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
