/**
 * Pure-function coverage for the two invented pieces of `GET /analytics/me`:
 * the Fitflix Score and the "What changed" insight rules. No server, no
 * database — everything below is a function of the payload blocks.
 *
 * These two carry all the judgement on that endpoint. Every other block is a
 * faithful read of something the backend already stores, so if a number on the
 * Progress screen is ever wrong in a way a member would notice, it is almost
 * certainly here.
 *
 * The cases that matter most are the refusals: a score that declines to
 * report, an insight card that stays empty. A dashboard that always has
 * something to say will eventually say something untrue.
 */

import type {
	BodyBlock,
	ConsistencyBlock,
	NutritionBlock,
	TrainingBlock,
} from "../src/types/analytics";
import { buildInsights } from "../src/utils/analytics-insights";
import { buildScore } from "../src/utils/fitflix-score";
import { assert } from "./test-helpers";

// ── Fixtures ────────────────────────────────────────────────────────────

const emptyBody: BodyBlock = {
	hasData: false,
	scanCount: 0,
	latest: null,
	baseline: null,
	deltas: {
		weightKg: null,
		bodyFatPercent: null,
		skeletalMuscleMassKg: null,
		bodyAge: null,
		totalBodyWaterL: null,
	},
	series: [],
};

const bodyWith = (
	deltas: Partial<BodyBlock["deltas"]>,
	scanCount = 4,
): BodyBlock => ({
	...emptyBody,
	hasData: true,
	scanCount,
	deltas: { ...emptyBody.deltas, ...deltas },
});

const emptyTraining: TrainingBlock = {
	hasData: false,
	sessions: 0,
	totalSets: 0,
	totalVolumeKg: 0,
	caloriesBurned: 0,
	avgDurationMinutes: null,
	previous: { sessions: 0, totalSets: 0, totalVolumeKg: 0, caloriesBurned: 0 },
	weekly: [],
	muscleSplit: [],
};

const trainingWith = (over: Partial<TrainingBlock>): TrainingBlock => ({
	...emptyTraining,
	hasData: true,
	...over,
});

const emptyNutrition: NutritionBlock = {
	hasData: false,
	daysLogged: 0,
	daysInPeriod: 30,
	avgConsumedKcal: 0,
	avgPlannedKcal: 0,
	avgCalorieAdherencePct: 0,
	macros: {
		proteinG: { consumed: 0, planned: 0 },
		carbsG: { consumed: 0, planned: 0 },
		fatG: { consumed: 0, planned: 0 },
	},
	previous: { daysLogged: 0, avgConsumedKcal: 0, avgCalorieAdherencePct: 0 },
	daily: [],
};

const nutritionWith = (over: Partial<NutritionBlock>): NutritionBlock => ({
	...emptyNutrition,
	hasData: true,
	...over,
});

const emptyConsistency: ConsistencyBlock = {
	hasData: false,
	currentStreak: 0,
	longestStreak: 0,
	visitsInPeriod: 0,
	daysVisitedInPeriod: 0,
	previousDaysVisited: 0,
	days: [],
};

const consistencyWith = (
	over: Partial<ConsistencyBlock>,
): ConsistencyBlock => ({
	...emptyConsistency,
	hasData: true,
	...over,
});

/** 30 days of diary entries, with [missedWeekdays] left unlogged every week. */
const dailyFor = (missedWeekdays: number[] = []): NutritionBlock["daily"] => {
	const days: NutritionBlock["daily"] = [];
	// 2026-06-01 is a Monday, so weekday indices below are stable.
	for (let i = 0; i < 30; i++) {
		const date = new Date(Date.UTC(2026, 5, 1 + i));
		const logged = !missedWeekdays.includes(date.getUTCDay());
		days.push({
			date: date.toISOString().slice(0, 10),
			consumedKcal: logged ? 2180 : 0,
			plannedKcal: 2400,
			logged,
		});
	}
	return days;
};

const scoreInputs = (over: {
	training?: TrainingBlock;
	body?: BodyBlock;
	nutrition?: NutritionBlock;
	consistency?: ConsistencyBlock;
}) => ({
	days: 30,
	training: over.training ?? emptyTraining,
	body: over.body ?? emptyBody,
	nutrition: over.nutrition ?? emptyNutrition,
	consistency: over.consistency ?? emptyConsistency,
	weeklySessionTarget: 4,
});

// ── Tests ───────────────────────────────────────────────────────────────

function runUnitTests() {
	console.log("\n🔎 The score refuses to report when it cannot");
	{
		const nothing = buildScore(scoreInputs({}));
		assert(!nothing.hasData, "a member with no data at all is not scored");
		assert(nothing.value === null, "and carries no value to render");
		assert(
			nothing.pillars.length === 4,
			"but every pillar is still present, so the client can say which are missing",
		);
		assert(
			nothing.pillars.every((p) => !p.hasData),
			"each flagged as having no data",
		);

		const onePillar = buildScore(
			scoreInputs({ training: trainingWith({ sessions: 12 }) }),
		);
		assert(
			!onePillar.hasData,
			"one pillar is not enough to average — still unscored",
		);

		const twoPillars = buildScore(
			scoreInputs({
				training: trainingWith({ sessions: 12 }),
				consistency: consistencyWith({ daysVisitedInPeriod: 14 }),
			}),
		);
		assert(twoPillars.hasData, "two pillars is the floor, and it reports");
	}

	console.log("\n🔎 A missing pillar is excluded, never scored as zero");
	{
		// Same training and consistency; one member has never had a scan.
		// 18 sessions clears the 30-day target of ~17.1, so both reporting
		// pillars sit at a clean 100 and the renormalisation is unambiguous.
		const withoutBody = buildScore(
			scoreInputs({
				training: trainingWith({ sessions: 18 }),
				consistency: consistencyWith({ daysVisitedInPeriod: 18 }),
			}),
		);
		const withFlatBody = buildScore(
			scoreInputs({
				training: trainingWith({ sessions: 18 }),
				consistency: consistencyWith({ daysVisitedInPeriod: 18 }),
				body: bodyWith({ bodyFatPercent: 0, skeletalMuscleMassKg: 0 }),
			}),
		);

		assert(
			withoutBody.value === 100,
			`no scan renormalises to the pillars that reported (got ${withoutBody.value})`,
		);
		assert(
			withFlatBody.value !== null && withFlatBody.value < 100,
			"whereas a scan showing no change genuinely does pull the average down",
		);
		assert(
			!withoutBody.pillars.find((p) => p.key === "body")?.hasData,
			"and the body pillar is reported as absent, not as a zero",
		);
	}

	console.log("\n🔎 Body scores direction of travel, not an absolute");
	{
		const oneScan = buildScore(
			scoreInputs({
				body: bodyWith({ bodyFatPercent: -2 }, 1),
				training: trainingWith({ sessions: 10 }),
			}),
		);
		assert(
			!oneScan.pillars.find((p) => p.key === "body")?.hasData,
			"a single scan has no direction yet, so body stays unscored",
		);

		const losingFat = buildScore(
			scoreInputs({
				body: bodyWith({ bodyFatPercent: -3, skeletalMuscleMassKg: 1 }),
				training: trainingWith({ sessions: 10 }),
			}),
		);
		const gainingFat = buildScore(
			scoreInputs({
				body: bodyWith({ bodyFatPercent: 3, skeletalMuscleMassKg: -1 }),
				training: trainingWith({ sessions: 10 }),
			}),
		);
		const flat = buildScore(
			scoreInputs({
				body: bodyWith({ bodyFatPercent: 0, skeletalMuscleMassKg: 0 }),
				training: trainingWith({ sessions: 10 }),
			}),
		);

		const bodyOf = (s: ReturnType<typeof buildScore>) =>
			s.pillars.find((p) => p.key === "body")?.value ?? -1;

		assert(bodyOf(flat) === 50, `no change scores 50 (got ${bodyOf(flat)})`);
		assert(bodyOf(losingFat) > 50, "fat down and muscle up scores above it");
		assert(bodyOf(gainingFat) < 50, "the reverse scores below it");
	}

	console.log("\n🔎 Nutrition needs both coverage and accuracy");
	{
		const pillarOf = (n: NutritionBlock) =>
			buildScore(
				scoreInputs({ nutrition: n, training: trainingWith({ sessions: 10 }) }),
			).pillars.find((p) => p.key === "nutrition")?.value ?? -1;

		const perfect = pillarOf(
			nutritionWith({ daysLogged: 30, avgCalorieAdherencePct: 100 }),
		);
		const sparseButAccurate = pillarOf(
			nutritionWith({ daysLogged: 4, avgCalorieAdherencePct: 100 }),
		);
		const thoroughButOff = pillarOf(
			nutritionWith({ daysLogged: 30, avgCalorieAdherencePct: 50 }),
		);

		assert(
			perfect === 100,
			`logging every day on target is 100 (got ${perfect})`,
		);
		assert(
			sparseButAccurate < 20,
			"four perfect days out of thirty is not a good month",
		);
		assert(
			thoroughButOff < perfect,
			"nor is logging every day at half the target",
		);
	}

	console.log("\n🔎 Insights stay quiet rather than pad");
	{
		const quiet = buildInsights({
			body: emptyBody,
			training: emptyTraining,
			nutrition: emptyNutrition,
			consistency: emptyConsistency,
			previousMuscleSplit: [],
		});
		assert(quiet.length === 0, "a member with no data gets no observations");

		const oneRuleOnly = buildInsights({
			body: emptyBody,
			training: emptyTraining,
			nutrition: emptyNutrition,
			consistency: consistencyWith({ currentStreak: 6, longestStreak: 19 }),
			previousMuscleSplit: [],
		});
		assert(
			oneRuleOnly.length === 0,
			"and a single firing rule is suppressed — the card hides rather than showing one line",
		);
	}

	console.log("\n🔎 Insights that do fire say something checkable");
	{
		const insights = buildInsights({
			body: bodyWith({
				bodyFatPercent: -2.3,
				skeletalMuscleMassKg: 0.2,
				weightKg: -2.6,
			}),
			training: trainingWith({
				totalVolumeKg: 68420,
				previous: {
					sessions: 11,
					totalSets: 400,
					totalVolumeKg: 61600,
					caloriesBurned: 0,
				},
			}),
			nutrition: nutritionWith({
				daysLogged: 22,
				daily: dailyFor([0, 6]),
			}),
			consistency: consistencyWith({ currentStreak: 6, longestStreak: 19 }),
			previousMuscleSplit: [],
		});

		assert(insights.length === 3, `capped at three (got ${insights.length})`);

		const fatHeld = insights.find((i) => i.code === "FAT_DOWN_MUSCLE_HELD");
		assert(!!fatHeld, "fat down while muscle held is reported");
		assert(
			fatHeld?.text.includes("2.3 points") === true,
			`and quotes the real delta (got: ${fatHeld?.text})`,
		);

		const gaps = insights.find((i) => i.code === "LOGGING_GAPS_CLUSTERED");
		assert(!!gaps, "clustered logging gaps are reported");
		assert(
			gaps?.text.includes("Sundays") === true &&
				gaps?.text.includes("Saturdays") === true,
			`and name the actual weekdays missed (got: ${gaps?.text})`,
		);
	}

	console.log("\n🔎 An insight that would be misleading does not fire");
	{
		// Fat down, but muscle fell 1.8 kg with it — that is not "losing fat,
		// not mass", and saying so would be the worst kind of wrong.
		const losingBoth = buildInsights({
			body: bodyWith({ bodyFatPercent: -2.3, skeletalMuscleMassKg: -1.8 }),
			training: trainingWith({ sessions: 10 }),
			nutrition: nutritionWith({ daysLogged: 22, daily: dailyFor([0, 6]) }),
			consistency: consistencyWith({ currentStreak: 6, longestStreak: 19 }),
			previousMuscleSplit: [],
		});
		assert(
			!losingBoth.some((i) => i.code === "FAT_DOWN_MUSCLE_HELD"),
			"muscle lost alongside fat does not get congratulated",
		);

		// Gaps spread evenly across the week are not a pattern worth naming.
		const scattered = buildInsights({
			body: bodyWith({ bodyFatPercent: -2.3, skeletalMuscleMassKg: 0.2 }),
			training: trainingWith({ sessions: 10 }),
			nutrition: nutritionWith({
				daysLogged: 24,
				daily: dailyFor().map((d, i) => ({ ...d, logged: i % 5 !== 0 })),
			}),
			consistency: consistencyWith({ currentStreak: 6, longestStreak: 19 }),
			previousMuscleSplit: [],
		});
		assert(
			!scattered.some((i) => i.code === "LOGGING_GAPS_CLUSTERED"),
			"gaps with no weekday pattern are not reported as one",
		);
	}

	console.log("\n🔎 Muscle-group neglect needs two periods, not one");
	{
		const split = [
			{ group: "Legs", volumeKg: 20000, sets: 100, percent: 40 },
			{ group: "Back", volumeKg: 15000, sets: 80, percent: 35 },
			{ group: "Core", volumeKg: 3000, sets: 20, percent: 5 },
		];
		const base = {
			body: bodyWith({ bodyFatPercent: -2.3, skeletalMuscleMassKg: 0.2 }),
			nutrition: emptyNutrition,
			consistency: consistencyWith({ currentStreak: 6, longestStreak: 19 }),
		};

		const firstPeriod = buildInsights({
			...base,
			training: trainingWith({ muscleSplit: split }),
			previousMuscleSplit: [{ group: "Core", percent: 22 }],
		});
		assert(
			!firstPeriod.some((i) => i.code === "MUSCLE_GROUP_NEGLECTED"),
			"one low period is a training split, not a blind spot",
		);

		const secondPeriod = buildInsights({
			...base,
			training: trainingWith({ muscleSplit: split }),
			previousMuscleSplit: [{ group: "Core", percent: 7 }],
		});
		assert(
			secondPeriod.some((i) => i.code === "MUSCLE_GROUP_NEGLECTED"),
			"two low periods running is",
		);
	}

	console.log("\n🎉 Analytics score & insight tests passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Analytics score/insights test failed:", err);
	process.exit(1);
}
