/**
 * The Fitflix Score — the composite number at the top of the Progress screen.
 *
 * NOT to be confused with `health-score.ts`, which is the onboarding vitality
 * assessment (brand tiers, questionnaire categories). Different concept,
 * different inputs, different screen.
 *
 * Design constraint: every input is a ratio the member could check by hand.
 * A score nobody can audit is a number they stop trusting the first time it
 * moves the wrong way, so there is no hidden weighting curve here — four
 * pillars, each a percentage of a stated target, averaged.
 *
 * Pillars with no data drop out and the remaining weights renormalise, rather
 * than scoring zero. A member who has never had a body scan is not "0/100 on
 * body composition"; we simply do not know, and pretending otherwise would
 * punish them for a measurement they never had the chance to take.
 */

import type {
	BodyBlock,
	ConsistencyBlock,
	NutritionBlock,
	ScoreBlock,
	ScorePillar,
	ScorePillarKey,
	TrainingBlock,
} from "../types/analytics";

/** Below this many scoreable pillars the composite is not reported at all and
 *  the client hides the card — two data points is the floor at which an
 *  average means anything. */
const MIN_PILLARS = 2;

const WEIGHTS: Record<ScorePillarKey, number> = {
	training: 0.3,
	body: 0.2,
	nutrition: 0.25,
	consistency: 0.25,
};

/** Sessions per week we score against when the member has no assigned plan. */
export const DEFAULT_WEEKLY_SESSION_TARGET = 4;

/** Gym visits per week a full consistency score requires. */
const WEEKLY_VISIT_TARGET = 4;

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

const ratioScore = (actual: number, target: number): number =>
	target <= 0 ? 0 : clamp((actual / target) * 100);

export interface ScoreInputs {
	days: number;
	training: TrainingBlock;
	body: BodyBlock;
	nutrition: NutritionBlock;
	consistency: ConsistencyBlock;
	/** Sessions per week the member's assigned plan calls for, when they have
	 *  one. Falls back to [DEFAULT_WEEKLY_SESSION_TARGET]. */
	weeklySessionTarget: number;
}

/**
 * Body pillar: direction of travel, not an absolute.
 *
 * There is no universally "good" body-fat percentage to score against without
 * knowing goals we do not reliably hold, so this scores movement since the
 * baseline scan: 50 is flat, fat loss and muscle gain push up, the reverse
 * pushes down. A member with one scan has no direction yet and scores nothing.
 */
const scoreBody = (body: BodyBlock): number | null => {
	if (!body.hasData || body.scanCount < 2) return null;

	let score = 50;

	const fatDelta = body.deltas.bodyFatPercent;
	if (fatDelta !== null) {
		// 3 points of body fat in either direction saturates this half.
		score += Math.max(-25, Math.min(25, (-fatDelta / 3) * 25));
	}

	const muscleDelta = body.deltas.skeletalMuscleMassKg;
	if (muscleDelta !== null) {
		// 2 kg of skeletal muscle in either direction saturates this half.
		score += Math.max(-25, Math.min(25, (muscleDelta / 2) * 25));
	}

	return clamp(score);
};

/**
 * Nutrition pillar: how often they logged, times how close they landed.
 *
 * Both halves matter and neither substitutes for the other — perfect
 * adherence on four logged days out of thirty is not a good nutrition month,
 * and thirty logged days at half the target calories is not either.
 */
const scoreNutrition = (nutrition: NutritionBlock): number | null => {
	if (!nutrition.hasData || nutrition.daysInPeriod === 0) return null;

	const coverage = nutrition.daysLogged / nutrition.daysInPeriod;
	// Adherence is a percentage of target where 100 is on the nose; being 20%
	// over is as far off as being 20% under.
	const accuracy =
		nutrition.avgCalorieAdherencePct > 0
			? Math.max(0, 1 - Math.abs(100 - nutrition.avgCalorieAdherencePct) / 100)
			: 0;

	return clamp(coverage * accuracy * 100);
};

const scoreTraining = (
	training: TrainingBlock,
	days: number,
	weeklyTarget: number,
): number | null => {
	if (!training.hasData) return null;
	const target = (weeklyTarget * days) / 7;
	return ratioScore(training.sessions, target);
};

const scoreConsistency = (
	consistency: ConsistencyBlock,
	days: number,
): number | null => {
	if (!consistency.hasData) return null;
	const target = (WEEKLY_VISIT_TARGET * days) / 7;
	return ratioScore(consistency.daysVisitedInPeriod, target);
};

/** Builds the score block. `delta` is filled in by the caller, which runs this
 *  twice — once for the period, once for the window before it. */
export const buildScore = (inputs: ScoreInputs): ScoreBlock => {
	const raw: Record<ScorePillarKey, number | null> = {
		training: scoreTraining(
			inputs.training,
			inputs.days,
			inputs.weeklySessionTarget,
		),
		body: scoreBody(inputs.body),
		nutrition: scoreNutrition(inputs.nutrition),
		consistency: scoreConsistency(inputs.consistency, inputs.days),
	};

	const pillars: ScorePillar[] = (Object.keys(WEIGHTS) as ScorePillarKey[]).map(
		(key) => ({
			key,
			value: raw[key] ?? 0,
			hasData: raw[key] !== null,
		}),
	);

	const scoreable = pillars.filter((p) => p.hasData);
	if (scoreable.length < MIN_PILLARS) {
		return { hasData: false, value: null, delta: null, pillars };
	}

	// Renormalise over the pillars that actually reported.
	const totalWeight = scoreable.reduce((sum, p) => sum + WEIGHTS[p.key], 0);
	const value = Math.round(
		scoreable.reduce((sum, p) => sum + p.value * WEIGHTS[p.key], 0) /
			totalWeight,
	);

	return { hasData: true, value, delta: null, pillars };
};
