/**
 * "What changed" — the plain-language observations on the Progress screen.
 *
 * Rule-based and computed here rather than in the app, for two reasons: the
 * copy is fixable without shipping a release, and the rules can see all four
 * data blocks at once. Cross-referencing two sources ("fat down WHILE muscle
 * held") is the whole reason this screen exists instead of four separate ones,
 * and it is exactly what a per-card widget cannot do.
 *
 * No model call. These are deterministic thresholds over numbers the member
 * can see elsewhere on the same screen, so an insight is always checkable
 * against the card above it.
 */

import type {
	BodyBlock,
	ConsistencyBlock,
	Insight,
	NutritionBlock,
	TrainingBlock,
} from "../types/analytics";

/** Never show more than this many — the card is a glance, not a report. */
const MAX_INSIGHTS = 3;

/** Below this, the card is hidden entirely rather than padded out with
 *  whatever weak observation happened to fire. */
const MIN_INSIGHTS = 2;

const WEEKDAY_NAMES = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Strip any time component a caller may have left on a date string. */
const dateOnly = (value: string): string => value.slice(0, 10);

export interface InsightInputs {
	body: BodyBlock;
	training: TrainingBlock;
	nutrition: NutritionBlock;
	consistency: ConsistencyBlock;
	/** Muscle split over the preceding window, used by the "neglected two
	 *  periods running" rule. */
	previousMuscleSplit: Array<{ group: string; percent: number }>;
}

/** Fat down while muscle held — the outcome members actually want, and the
 *  one a bathroom scale cannot tell them. */
const fatDownMuscleHeld = (body: BodyBlock): Insight | null => {
	const fat = body.deltas.bodyFatPercent;
	const muscle = body.deltas.skeletalMuscleMassKg;
	if (fat === null || muscle === null) return null;
	if (fat > -1 || Math.abs(muscle) > 0.5) return null;

	return {
		code: "FAT_DOWN_MUSCLE_HELD",
		tone: "positive",
		text: `Body fat is down ${round1(-fat)} points across ${body.scanCount} scans while muscle held steady — you're losing fat, not mass.`,
		values: {
			bodyFatDelta: round1(fat),
			skeletalMuscleDelta: round1(muscle),
			scanCount: body.scanCount,
		},
	};
};

/** Logging gaps that cluster on the same weekdays. Naming the pattern is
 *  actionable in a way that "you missed 6 days" is not. */
const loggingGapsClustered = (nutrition: NutritionBlock): Insight | null => {
	const missed = nutrition.daily.filter((d) => !d.logged);
	if (missed.length < 3) return null;

	const byWeekday = new Map<number, number>();
	for (const day of missed) {
		const weekday = new Date(`${dateOnly(day.date)}T00:00:00Z`).getUTCDay();
		byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + 1);
	}

	const ranked = [...byWeekday.entries()].sort((a, b) => b[1] - a[1]);
	const topTwo = ranked.slice(0, 2);
	const covered = topTwo.reduce((sum, [, count]) => sum + count, 0);
	if (covered / missed.length < 0.6) return null;

	const names = topTwo.map(([weekday]) => WEEKDAY_NAMES[weekday]);
	const dayPhrase =
		names.length === 2 ? `${names[0]}s and ${names[1]}s` : `${names[0]}s`;

	return {
		code: "LOGGING_GAPS_CLUSTERED",
		tone: "attention",
		text: `You logged food on ${nutrition.daysLogged} of ${nutrition.daysInPeriod} days. Most of the gaps were ${dayPhrase}.`,
		values: {
			daysLogged: nutrition.daysLogged,
			daysInPeriod: nutrition.daysInPeriod,
			missedDays: missed.length,
		},
	};
};

/** A muscle group under 10% of working sets for two periods running. One
 *  period is a training split; two is a blind spot. */
const muscleGroupNeglected = (
	training: TrainingBlock,
	previousSplit: Array<{ group: string; percent: number }>,
): Insight | null => {
	if (training.muscleSplit.length < 3) return null;

	const lowest = training.muscleSplit.reduce((min, slice) =>
		slice.percent < min.percent ? slice : min,
	);
	if (lowest.percent >= 10) return null;

	const previous = previousSplit.find((s) => s.group === lowest.group);
	if (!previous || previous.percent >= 10) return null;

	return {
		code: "MUSCLE_GROUP_NEGLECTED",
		tone: "attention",
		text: `${lowest.group} work is ${Math.round(lowest.percent)}% of your working sets — the lowest of any group, two periods running.`,
		values: { group: lowest.group, percent: Math.round(lowest.percent) },
	};
};

/** Training load rising while scan weight falls. Worth naming because the
 *  scale alone reads as "losing", which is ambiguous. */
const volumeUpWeightDown = (
	training: TrainingBlock,
	body: BodyBlock,
): Insight | null => {
	const weightDelta = body.deltas.weightKg;
	if (weightDelta === null || weightDelta >= 0) return null;
	if (training.previous.totalVolumeKg <= 0) return null;

	const change =
		(training.totalVolumeKg - training.previous.totalVolumeKg) /
		training.previous.totalVolumeKg;
	if (change < 0.05) return null;

	return {
		code: "VOLUME_UP_WEIGHT_DOWN",
		tone: "positive",
		text: `Training volume is up ${Math.round(change * 100)}% while your weight came down ${round1(-weightDelta)} kg — you're getting stronger on less bodyweight.`,
		values: {
			volumeChangePct: Math.round(change * 100),
			weightDelta: round1(weightDelta),
		},
	};
};

/** Streak worth calling out. Deliberately last — it is the least informative
 *  of the five, so it only surfaces when the others stayed quiet. */
const streakRunning = (consistency: ConsistencyBlock): Insight | null => {
	if (consistency.currentStreak < 3) return null;
	return {
		code: "STREAK_RUNNING",
		tone: "positive",
		text: `You're ${consistency.currentStreak} days into a check-in streak. Your best is ${consistency.longestStreak}.`,
		values: {
			currentStreak: consistency.currentStreak,
			longestStreak: consistency.longestStreak,
		},
	};
};

export const buildInsights = (inputs: InsightInputs): Insight[] => {
	const candidates = [
		fatDownMuscleHeld(inputs.body),
		volumeUpWeightDown(inputs.training, inputs.body),
		loggingGapsClustered(inputs.nutrition),
		muscleGroupNeglected(inputs.training, inputs.previousMuscleSplit),
		streakRunning(inputs.consistency),
	].filter((insight): insight is Insight => insight !== null);

	if (candidates.length < MIN_INSIGHTS) return [];
	return candidates.slice(0, MAX_INSIGHTS);
};
