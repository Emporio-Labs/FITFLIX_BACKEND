/**
 * Gym-visit streak arithmetic, shared by `GET /gym-visits/me` and
 * `GET /analytics/me`.
 *
 * Extracted verbatim from `gymVisit.controller.ts` (which now imports from
 * here) so the Progress screen and the Attendance ledger can never disagree
 * about what a member's streak is. Two copies of this would drift the first
 * time either one was tuned.
 *
 * Days are IST calendar days, not UTC. A member checking in at 11pm IST is
 * inside that day, not the next one — which is what UTC bucketing would say
 * for anyone training after 6:30pm.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` for the IST calendar day containing [date]. */
export const toISTDateString = (date: Date): string => {
	const local = new Date(date.getTime() + IST_OFFSET_MS);
	const y = local.getUTCFullYear();
	const m = String(local.getUTCMonth() + 1).padStart(2, "0");
	const d = String(local.getUTCDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
};

/**
 * Current and longest consecutive-day streaks from unique visit day strings
 * (`YYYY-MM-DD`, sorted descending).
 *
 * The current streak starts at today if visited, else yesterday — so a member
 * who has not been in yet today still sees the streak they are carrying,
 * rather than a zero that reappears as a six the moment they scan in.
 */
export function computeStreaks(sortedDescDays: string[]): {
	currentStreak: number;
	longestStreak: number;
} {
	if (sortedDescDays.length === 0)
		return { currentStreak: 0, longestStreak: 0 };

	const todayIST = toISTDateString(new Date());
	const yesterdayIST = toISTDateString(new Date(Date.now() - DAY_MS));

	const daySet = new Set(sortedDescDays);

	let currentStreak = 0;
	const startDay = daySet.has(todayIST)
		? todayIST
		: daySet.has(yesterdayIST)
			? yesterdayIST
			: null;
	if (startDay) {
		let cursor = new Date(`${startDay}T00:00:00Z`);
		while (true) {
			const key = toISTDateString(cursor);
			if (!daySet.has(key)) break;
			currentStreak++;
			cursor = new Date(cursor.getTime() - DAY_MS);
		}
	}

	let longestStreak = 0;
	let run = 1;
	const asc = [...sortedDescDays].reverse();
	for (let i = 1; i < asc.length; i++) {
		const prev = new Date(`${asc[i - 1]}T00:00:00Z`);
		const curr = new Date(`${asc[i]}T00:00:00Z`);
		const diffDays = Math.round((curr.getTime() - prev.getTime()) / DAY_MS);
		if (diffDays === 1) {
			run++;
		} else {
			longestStreak = Math.max(longestStreak, run);
			run = 1;
		}
	}
	longestStreak = Math.max(longestStreak, run);

	return { currentStreak, longestStreak };
}
