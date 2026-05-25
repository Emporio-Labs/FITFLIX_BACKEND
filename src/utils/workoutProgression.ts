import type { WorkoutPlanAssignmentDocument } from "../models/WorkoutPlanAssignment";

type DayProgress = WorkoutPlanAssignmentDocument["dayProgress"][number];
type UserDay = WorkoutPlanAssignmentDocument["userDays"][number];

/** Adds `days` calendar days to `date` (UTC-safe). */
const addDays = (date: Date, days: number): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));

/** Returns UTC midnight for `date`. */
const utcMidnight = (date: Date): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/**
 * Build the initial `dayProgress` array from plan days + assignment start date.
 * Each day gets a sequential `scheduledDate` starting from `startDate`.
 * Rest days count as calendar days (they reserve a date but need no session).
 */
export function initializeSchedule(
	planDays: UserDay[],
	startDate: Date,
): DayProgress[] {
	const base = utcMidnight(startDate);
	return planDays.map((day, i) => ({
		dayNumber: day.dayNumber,
		scheduledDate: addDays(base, i),
		completedAt: null,
		sessionId: null,
		status: "pending" as const,
	}));
}

/**
 * Mark `dayNumber` as completed and shift all remaining PENDING days forward.
 * COMPLETED days are never modified (history is immutable).
 *
 * Returns the mutated assignment (caller is responsible for saving to DB).
 */
export function completeDayAndShift(
	assignment: WorkoutPlanAssignmentDocument,
	dayNumber: number,
	sessionId: string,
	completedDate: Date,
): WorkoutPlanAssignmentDocument {
	const completedUtc = utcMidnight(completedDate);

	// Mark the completed day
	const target = assignment.dayProgress.find((d) => d.dayNumber === dayNumber);
	if (target) {
		target.status = "completed";
		target.completedAt = completedUtc;
		(target as any).sessionId = sessionId;
	}

	// Advance currentDayIndex to next non-completed day
	const nextPending = assignment.dayProgress.findIndex(
		(d) => d.status === "pending",
	);
	assignment.currentDayIndex = nextPending >= 0 ? nextPending : assignment.dayProgress.length;

	// Reschedule only remaining PENDING days (never touch completed entries)
	let nextDate = addDays(completedUtc, 1);
	for (const day of assignment.dayProgress) {
		if (day.status !== "pending") continue;
		day.scheduledDate = nextDate;
		nextDate = addDays(nextDate, 1);
	}

	// Mark assignment completed if all days are done
	if (assignment.currentDayIndex >= assignment.dayProgress.length) {
		assignment.status = "completed";
	}

	return assignment;
}

/**
 * Lazily advance missed days.
 * For each PENDING day whose `scheduledDate < today`:
 *   1. Mark it `missed`
 *   2. Reschedule all remaining PENDING days starting from today
 *   3. Update `currentDayIndex` to the first non-missed PENDING day
 *
 * Completed days are never touched.
 * Returns `true` if any days were shifted (caller should save to DB).
 */
export function advancePastMissedDays(
	assignment: WorkoutPlanAssignmentDocument,
): boolean {
	const today = utcMidnight(new Date());
	let changed = false;

	// Mark all past-due pending days as missed
	for (const day of assignment.dayProgress) {
		if (day.status === "pending" && day.scheduledDate < today) {
			day.status = "missed";
			changed = true;
		}
	}

	if (!changed) return false;

	// Reschedule all remaining PENDING days from today onward
	let nextDate = today;
	for (const day of assignment.dayProgress) {
		if (day.status !== "pending") continue;
		day.scheduledDate = nextDate;
		nextDate = addDays(nextDate, 1);
	}

	// Update currentDayIndex to first non-missed pending day
	const nextPending = assignment.dayProgress.findIndex(
		(d) => d.status === "pending",
	);
	assignment.currentDayIndex =
		nextPending >= 0 ? nextPending : assignment.dayProgress.length;

	return true;
}
