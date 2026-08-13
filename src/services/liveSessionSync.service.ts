import mongoose from "mongoose";
import { ExerciseSection, WorkoutSessionStatus } from "../models/Enums";
import SetLog from "../models/SetLog";
import WorkoutExercise from "../models/WorkoutExercise";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import WorkoutSession from "../models/WorkoutSession";
import type { AppUserRole } from "../types/auth";
import { actorModelForRole } from "../utils/actor-model";

const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

/**
 * Synchronize an active WorkoutSession for today with prescribed exercises
 * from the user's active WorkoutPlanAssignment.
 *
 * Safe behavior:
 * - Keeps any WorkoutExercise documents that already have logged sets.
 * - Replaces or appends uncompleted/unlogged WorkoutExercise documents to match
 *   the assigned prescribed exercises for today.
 * - Touches `session.updatedAt` and `lastTouchedBy` so live-polling clients
 *   immediately pick up changes.
 */
export async function syncActiveSessionFromAssignment(
	userId: mongoose.Types.ObjectId,
	actorId?: string,
	actorRole?: AppUserRole,
): Promise<any> {
	const today = normalizeToUtcDate(new Date());

	const session = await WorkoutSession.findOne({
		userId,
		date: today,
		status: WorkoutSessionStatus.Active,
	});

	if (!session) return null;

	const assignment = await WorkoutPlanAssignment.findOne({
		userId,
		status: "active",
		isDeleted: { $ne: true },
	});

	if (!assignment) return session;

	// Find scheduled entry for today in dayProgress (or first pending entry matching day)
	const todayEntry =
		assignment.dayProgress.find(
			(d) =>
				d.status === "pending" &&
				normalizeToUtcDate(d.scheduledDate).getTime() === today.getTime(),
		) || assignment.dayProgress.find((d) => d.status === "pending");

	if (!todayEntry) return session;

	const userDay = assignment.userDays.find(
		(d) => d.dayNumber === todayEntry.dayNumber,
	);
	if (!userDay || !userDay.exercises || userDay.exercises.length === 0) {
		return session;
	}

	const existingExercises = await WorkoutExercise.find({
		sessionId: session._id,
	});
	const existingWorkoutExerciseIds = existingExercises.map((we) => we._id);

	// Find sets logged for existing exercises
	const loggedSets = await SetLog.find({
		workoutExerciseId: { $in: existingWorkoutExerciseIds },
	});
	const loggedExerciseIds = new Set(
		loggedSets.map((s) => s.workoutExerciseId.toString()),
	);

	// Remove unlogged WorkoutExercise documents
	const toDeleteIds = existingExercises
		.filter((we) => !loggedExerciseIds.has(we._id.toString()))
		.map((we) => we._id);

	if (toDeleteIds.length > 0) {
		await WorkoutExercise.deleteMany({ _id: { $in: toDeleteIds } });
	}

	// Remaining exercises with logged sets
	const remainingExercises = existingExercises.filter((we) =>
		loggedExerciseIds.has(we._id.toString()),
	);
	const existingExIdSet = new Set(
		remainingExercises.map((we) => we.exerciseId.toString()),
	);

	let nextOrderIndex = remainingExercises.length;

	for (const planEx of userDay.exercises) {
		if (!planEx.exerciseId) continue;
		if (existingExIdSet.has(planEx.exerciseId.toString())) continue;

		await WorkoutExercise.create({
			sessionId: session._id,
			exerciseId: planEx.exerciseId,
			orderIndex: nextOrderIndex++,
			section: (planEx.section as ExerciseSection) || ExerciseSection.Workout,
			targetSets: planEx.targetSets || 3,
			targetReps: planEx.targetReps || 10,
			targetWeightKg: planEx.targetWeightKg || 0,
			restSeconds: planEx.restSeconds || 60,
			durationSeconds: planEx.durationSeconds || null,
			notes: planEx.notes || null,
		});
	}

	if (actorId && mongoose.Types.ObjectId.isValid(actorId) && actorRole) {
		session.lastTouchedBy = new mongoose.Types.ObjectId(actorId);
		session.lastTouchedByModel = actorModelForRole(actorRole);
	}
	session.updatedAt = new Date();
	await session.save();

	return session;
}
