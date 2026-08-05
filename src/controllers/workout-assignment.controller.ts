import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Exercise from "../models/Exercise";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import { createAssignmentForUser } from "../services/planAssignment.service";
import { actorModelForRole } from "../utils/actor-model";
import {
	advancePastMissedDays,
	completeDayAndShift,
	initializeSchedule,
} from "../utils/workoutProgression";
import {
	assignPlanBodySchema,
	completePlanDayBodySchema,
	scheduleQuerySchema,
	updateAssignmentDayBodySchema,
} from "../validators/workout-assignment.validator";

const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const getRequesterId = (req: Parameters<RequestHandler>[0]): string | null => {
	const userId = req.user?.id;
	return typeof userId === "string" ? userId : null;
};

// ── GET /workout-plans/assignments/mine ───────────────────────────────────────

export const getMyAssignment: RequestHandler = async (req, res, next) => {
	try {
		const requesterId = getRequesterId(req);
		if (!requesterId) {
			res.status(403).json({ error: "Unauthorized" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(requesterId);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		})
			.select("-userDays.exercises")
			.populate({
				path: "assignedBy",
				select: "name imageUrl specialities keySentence title bio",
			})
			.populate({
				path: "planId",
				select: "name goal splitType description durationWeeks",
			})
			.lean();

		if (!assignment) {
			res.status(404).json({ error: "No active assignment found" });
			return;
		}

		res.json(assignment);
	} catch (error) {
		next(error);
	}
};

// ── GET /workout-plans/assignments/user/:userId ──────────────────────────────

export const getUserAssignment: RequestHandler = async (req, res, next) => {
	try {
		const userIdParam = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
		if (!userIdParam || !mongoose.Types.ObjectId.isValid(userIdParam)) {
			res.status(400).json({ error: "Invalid user ID" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(userIdParam);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		})
			.populate({
				path: "assignedBy",
				select: "name imageUrl specialities keySentence title bio",
			})
			.populate({
				path: "planId",
				select: "name goal splitType description durationWeeks",
			})
			.lean();

		if (!assignment) {
			res.status(404).json({ error: "No active assignment found for user" });
			return;
		}

		const exerciseIds = new Set<string>();
		for (const day of assignment.userDays) {
			for (const ex of day.exercises) {
				if (ex.exerciseId) exerciseIds.add(ex.exerciseId.toString());
			}
		}

		// Deliberately not filtered on `isDeleted`: an assignment that references
		// a since-deleted exercise still has to render its name. Pickers filter
		// it out instead (see listExercises).
		const exerciseDocs = await Exercise.find({
			_id: { $in: Array.from(exerciseIds).map((id) => new mongoose.Types.ObjectId(id)) },
		})
			.select("_id name muscleGroup difficulty equipment caloriesPerSet")
			.lean();

		const exMap = new Map(exerciseDocs.map((e) => [e._id.toString(), e]));

		const userDaysDetailed = assignment.userDays.map((day) => ({
			...day,
			exercises: day.exercises.map((ex) => {
				const info = exMap.get(ex.exerciseId.toString());
				return {
					...ex,
					name: info?.name ?? "Deleted exercise",
					muscleGroup: info?.muscleGroup ?? "FullBody",
					// The referenced Exercise document no longer exists, so its
					// name is unrecoverable and a trainer has to pick a
					// replacement. Flagged rather than left to look like a
					// rendering glitch.
					...(info ? {} : { exerciseMissing: true }),
				};
			}),
		}));

		res.json({
			...assignment,
			userDays: userDaysDetailed,
		});
	} catch (error) {
		next(error);
	}
};

// ── PATCH /workout-plans/assignments/user/:userId/days/:dayNumber ─────────────

export const updateUserDayExercises: RequestHandler = async (req, res, next) => {
	try {
		const userIdParam = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
		const dayNumber = parseInt(String(req.params.dayNumber), 10);
		if (!userIdParam || !mongoose.Types.ObjectId.isValid(userIdParam) || isNaN(dayNumber) || dayNumber < 1) {
			res.status(400).json({ error: "Invalid parameters" });
			return;
		}

		const parsed = updateAssignmentDayBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const userId = new mongoose.Types.ObjectId(userIdParam);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.status(404).json({ error: "No active assignment found" });
			return;
		}

		const dayIdx = assignment.userDays.findIndex((d) => d.dayNumber === dayNumber);
		if (dayIdx < 0) {
			res.status(404).json({ error: "Day not found in assignment" });
			return;
		}

		const userDay = assignment.userDays[dayIdx];
		if (!userDay) {
			res.status(404).json({ error: "Day not found in assignment" });
			return;
		}

		userDay.exercises = parsed.data.exercises as any;
		assignment.markModified("userDays");
		await assignment.save();

		res.json({ message: "Member day exercises updated successfully" });
	} catch (error) {
		next(error);
	}
};

// ── GET /workout-plans/assignments/mine/schedule ──────────────────────────────

export const getAssignmentSchedule: RequestHandler = async (req, res, next) => {
	try {
		const parsed = scheduleQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const requesterId = getRequesterId(req);
		if (!requesterId) {
			res.status(403).json({ error: "Unauthorized" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(requesterId);
		const now = new Date();
		const from = parsed.data.from || new Date(now.getTime() - 30 * 86400000);
		const to = parsed.data.to || new Date(now.getTime() + 90 * 86400000);

		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.json({ schedule: [], assignment: null });
			return;
		}

		// Lazily advance missed days and persist if changed
		const shifted = advancePastMissedDays(assignment);
		if (shifted) {
			await assignment.save();
		}

		// Resolve plan day names (from userDays)
		const dayNameMap = new Map<number, string>(
			assignment.userDays.map((d) => [d.dayNumber, d.name]),
		);

		const fromUtc = normalizeToUtcDate(from);
		const toUtc = normalizeToUtcDate(to);

		const schedule = assignment.dayProgress
			.filter((d) => {
				const sd = normalizeToUtcDate(d.scheduledDate);
				return sd >= fromUtc && sd <= toUtc;
			})
			.map((d) => {
				const userDay = assignment.userDays.find(
					(ud) => ud.dayNumber === d.dayNumber,
				);
				const isRest = userDay?.isRestDay ?? false;
				return {
					date: normalizeToUtcDate(d.scheduledDate)
						.toISOString()
						.substring(0, 10),
					dayNumber: d.dayNumber,
					dayName: dayNameMap.get(d.dayNumber) ?? `Day ${d.dayNumber}`,
					status: isRest ? "rest" : d.status,
					sessionId: d.sessionId ? d.sessionId.toString() : null,
				};
			});

		res.json({
			schedule,
			assignment: {
				id: assignment._id,
				currentDayIndex: assignment.currentDayIndex,
				status: assignment.status,
			},
		});
	} catch (error) {
		next(error);
	}
};

// ── GET /workout-plans/assignments/mine/today ─────────────────────────────────

export const getTodayAssignedWorkout: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const requesterId = getRequesterId(req);
		if (!requesterId) {
			res.status(403).json({ error: "Unauthorized" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(requesterId);
		const today = normalizeToUtcDate(new Date());

		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.status(404).json({ error: "No active assignment" });
			return;
		}

		// Lazily advance missed days
		const shifted = advancePastMissedDays(assignment);
		if (shifted) await assignment.save();

		// Find the day scheduled for today (or first pending day)
		const todayEntry = assignment.dayProgress.find(
			(d) =>
				d.status === "pending" &&
				normalizeToUtcDate(d.scheduledDate).getTime() === today.getTime(),
		);

		if (!todayEntry) {
			res.status(404).json({ error: "No workout scheduled for today" });
			return;
		}

		await _respondWithDayDetail(res, assignment, todayEntry.dayNumber);
	} catch (error) {
		next(error);
	}
};

// ── GET /workout-plans/assignments/mine/days/:dayNumber ───────────────────────

export const getAssignedWorkoutForDay: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const dayNumber = parseInt(String(req.params.dayNumber), 10);
		if (isNaN(dayNumber) || dayNumber < 1) {
			res.status(400).json({ error: "Invalid day number" });
			return;
		}

		const requesterId = getRequesterId(req);
		if (!requesterId) {
			res.status(403).json({ error: "Unauthorized" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(requesterId);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.status(404).json({ error: "No active assignment" });
			return;
		}

		await _respondWithDayDetail(res, assignment, dayNumber);
	} catch (error) {
		next(error);
	}
};

// ── POST /workout-plans/:planId/assign ────────────────────────────────────────

export const assignPlan: RequestHandler = async (req, res, next) => {
	try {
		const planId = req.params.planId;
		if (
			typeof planId !== "string" ||
			!mongoose.Types.ObjectId.isValid(planId)
		) {
			res.status(400).json({ error: "Invalid plan ID" });
			return;
		}

		const parsed = assignPlanBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		try {
			const { assignment } = await createAssignmentForUser({
				planId,
				userId: req.user?.id ?? "",
				assignedBy: req.user?.id ?? "",
				assignedByModel: actorModelForRole(req.user?.role ?? "user"),
				startDate: parsed.data.startDate,
			});
			res.status(201).json(assignment);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "PLAN_NOT_FOUND") {
				res.status(404).json({ error: "Plan not found" });
				return;
			}
			throw err;
		}
	} catch (error) {
		next(error);
	}
};

// ── POST /workout-plans/assignments/mine/complete-day ─────────────────────────

export const completePlanDay: RequestHandler = async (req, res, next) => {
	try {
		const parsed = completePlanDayBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const requesterId = getRequesterId(req);
		if (!requesterId) {
			res.status(403).json({ error: "Unauthorized" });
			return;
		}

		const userId = new mongoose.Types.ObjectId(requesterId);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.status(404).json({ error: "No active assignment" });
			return;
		}

		const { dayNumber, sessionId } = parsed.data;
		const target = assignment.dayProgress.find(
			(d) => d.dayNumber === dayNumber,
		);
		if (!target || target.status === "completed") {
			res.status(400).json({ error: "Day not found or already completed" });
			return;
		}

		completeDayAndShift(assignment, dayNumber, sessionId, new Date());
		await assignment.save();

		res.json({
			assignment: {
				id: assignment._id,
				currentDayIndex: assignment.currentDayIndex,
				status: assignment.status,
			},
		});
	} catch (error) {
		next(error);
	}
};

// ── PATCH /workout-plans/assignments/mine/days/:dayNumber ─────────────────────

export const updateMyDayExercises: RequestHandler = async (req, res, next) => {
	try {
		const dayNumber = parseInt(String(req.params.dayNumber), 10);
		if (isNaN(dayNumber) || dayNumber < 1) {
			res.status(400).json({ error: "Invalid day number" });
			return;
		}

		const parsed = updateAssignmentDayBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const userId = new mongoose.Types.ObjectId(req.user!.id);
		const assignment = await WorkoutPlanAssignment.findOne({
			userId,
			status: "active",
			isDeleted: { $ne: true },
		});

		if (!assignment) {
			res.status(404).json({ error: "No active assignment" });
			return;
		}

		const dayIdx = assignment.userDays.findIndex(
			(d) => d.dayNumber === dayNumber,
		);
		if (dayIdx < 0) {
			res.status(404).json({ error: "Day not found in assignment" });
			return;
		}

		const userDay = assignment.userDays[dayIdx];
		if (!userDay) {
			res.status(404).json({ error: "Day not found in assignment" });
			return;
		}

		// Replace exercises on user's private copy only (template untouched)
		userDay.exercises = parsed.data.exercises as any;
		assignment.markModified("userDays");
		await assignment.save();

		res.json({ message: "Day exercises updated" });
	} catch (error) {
		next(error);
	}
};

// ── Internal helper ───────────────────────────────────────────────────────────

async function _respondWithDayDetail(
	res: Parameters<RequestHandler>[1],
	assignment: Awaited<ReturnType<typeof WorkoutPlanAssignment.findOne>>,
	dayNumber: number,
): Promise<void> {
	if (!assignment) {
		res.status(404).json({ error: "Assignment not found" });
		return;
	}

	const userDay = assignment.userDays.find((d) => d.dayNumber === dayNumber);
	if (!userDay) {
		res.status(404).json({ error: `Day ${dayNumber} not found in assignment` });
		return;
	}

	const progress = assignment.dayProgress.find(
		(d) => d.dayNumber === dayNumber,
	);

	// Populate exercise details
	const exerciseIds = userDay.exercises.map((e) => e.exerciseId);
	const exerciseDocs = await Exercise.find({ _id: { $in: exerciseIds } })
		.select("_id name muscleGroup difficulty equipment caloriesPerSet")
		.lean();

	const exerciseInfoMap = new Map(
		exerciseDocs.map((e) => [e._id.toString(), e]),
	);

	const exercises = userDay.exercises.map((ex) => {
		const info = exerciseInfoMap.get(ex.exerciseId.toString());
		return {
			exerciseId: ex.exerciseId,
			name: info?.name ?? "Unknown",
			muscleGroup: info?.muscleGroup ?? "FullBody",
			section: ex.section,
			targetSets: ex.targetSets,
			targetReps: ex.targetReps,
			targetWeightKg: ex.targetWeightKg,
			restSeconds: ex.restSeconds,
			durationSeconds: ex.durationSeconds ?? null,
			orderIndex: ex.orderIndex,
		};
	});

	res.json({
		dayNumber: userDay.dayNumber,
		dayName: userDay.name,
		isRestDay: userDay.isRestDay,
		exercises,
		scheduledDate: progress
			? normalizeToUtcDate(progress.scheduledDate)
					.toISOString()
					.substring(0, 10)
			: null,
		status: progress?.status ?? "pending",
	});
}
