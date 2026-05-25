import mongoose from "mongoose";
import WorkoutPlan from "../models/WorkoutPlan";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import { initializeSchedule } from "../utils/workoutProgression";

const normalizeToUtcDate = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

export interface CreateAssignmentArgs {
	planId: string;
	userId: string;
	assignedBy: string;
	startDate?: Date;
}

export interface CreateAssignmentResult {
	assignment: any;
	created: boolean;
}

/**
 * Create (or return existing) active WorkoutPlanAssignment for a user.
 *
 * Behavior:
 * - Idempotent per (userId, planId): if an active assignment already exists for
 *   the same plan, returns it with `created: false`.
 * - Enforces one-active-plan-per-user: any OTHER active assignment for the user
 *   is marked "abandoned" before the new one is created.
 * - Seeds `dayProgress` via initializeSchedule() and clones plan.days into
 *   `userDays` so per-user edits never mutate the template.
 */
export async function createAssignmentForUser(
	args: CreateAssignmentArgs,
): Promise<CreateAssignmentResult> {
	if (!mongoose.Types.ObjectId.isValid(args.planId)) {
		throw new Error("INVALID_PLAN_ID");
	}
	if (!mongoose.Types.ObjectId.isValid(args.userId)) {
		throw new Error("INVALID_USER_ID");
	}

	const planObjId = new mongoose.Types.ObjectId(args.planId);
	const userObjId = new mongoose.Types.ObjectId(args.userId);
	const startDate = normalizeToUtcDate(args.startDate ?? new Date());

	const plan = await WorkoutPlan.findById(planObjId).lean();
	if (!plan) throw new Error("PLAN_NOT_FOUND");

	// Idempotency: if an active assignment already exists for (user, plan), return it.
	const existing = await WorkoutPlanAssignment.findOne({
		userId: userObjId,
		planId: planObjId,
		status: "active",
		isDeleted: { $ne: true },
	});
	if (existing) return { assignment: existing, created: false };

	// One-active-per-user: abandon any other active assignment for this user.
	await WorkoutPlanAssignment.updateMany(
		{ userId: userObjId, status: "active", isDeleted: { $ne: true } },
		{ $set: { status: "abandoned" } },
	);

	const userDays = (plan.days as any[]).map((day) => ({
		dayNumber: day.dayNumber,
		name: day.name,
		isRestDay: day.isRestDay ?? false,
		exercises: (day.exercises ?? []).map((ex: any) => ({
			exerciseId: ex.exerciseId,
			orderIndex: ex.orderIndex,
			section: ex.section ?? "workout",
			targetSets: ex.targetSets,
			targetReps: ex.targetReps,
			targetWeightKg: ex.targetWeightKg ?? 0,
			restSeconds: ex.restSeconds ?? 60,
			durationSeconds: ex.durationSeconds ?? null,
		})),
	}));

	const dayProgress = initializeSchedule(userDays as any, startDate);

	const assignment = await WorkoutPlanAssignment.create({
		userId: userObjId,
		planId: planObjId,
		assignedBy: args.assignedBy,
		startDate,
		currentDayIndex: 0,
		status: "active",
		dayProgress,
		userDays,
	});

	return { assignment, created: true };
}
