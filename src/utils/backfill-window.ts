/**
 * How far back staff can add or change a member's workout.
 *
 * Trainers can back-fill PT sessions they forgot to log, but only for a short
 * window, so old records can't be rewritten quietly. Admins have no limit, so
 * they can still fix older mistakes. Members aren't limited either: their app
 * syncs sets it logged offline, possibly days later, and that must not fail.
 *
 * Override with WORKOUT_BACKFILL_WINDOW_DAYS.
 */
const parsed = Number(process.env.WORKOUT_BACKFILL_WINDOW_DAYS);
export const BACKFILL_WINDOW_DAYS =
	Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 7;

const UNLIMITED_ROLES = new Set(["admin", "ROLE_FRONT_DESK_STAFF", "user"]);

const utcDay = (d: Date): number =>
	Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** True when `role` may not add or change a session dated `sessionDate`. */
export const isOutsideBackfillWindow = (
	sessionDate: Date,
	role: string | undefined,
	now: Date = new Date(),
	windowDays: number = BACKFILL_WINDOW_DAYS,
): boolean => {
	if (role && UNLIMITED_ROLES.has(role)) return false;
	const earliest = utcDay(now) - windowDays * 86_400_000;
	return utcDay(sessionDate) < earliest;
};

export const backfillLockedMessage = (windowDays = BACKFILL_WINDOW_DAYS) =>
	`Workouts older than ${windowDays} days are locked. Ask an admin to change them.`;
