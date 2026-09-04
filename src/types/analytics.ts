/**
 * Response contract for `GET /analytics/me` — the single payload behind the
 * app's Progress screen.
 *
 * Every block carries its own `hasData`. A member with no scan, no plan and no
 * check-ins still gets a 200 with every block present and `hasData: false`, so
 * the client omits a card rather than rendering a value it cannot justify.
 * That is the same doctrine `TelemetryRow` already follows in the Flutter app:
 * a missing number is omitted, never dashed.
 */

export const ANALYTICS_PERIODS = ["7d", "30d", "90d", "365d"] as const;

export type AnalyticsPeriodKey = (typeof ANALYTICS_PERIODS)[number];

/** Day count per period key. Drives both the current window and the
 *  equal-length preceding window used for every `delta` on this payload. */
export const PERIOD_DAYS: Record<AnalyticsPeriodKey, number> = {
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"365d": 365,
};

export interface AnalyticsPeriodInfo {
	key: AnalyticsPeriodKey;
	from: string;
	to: string;
	days: number;
}

// ── Body ────────────────────────────────────────────────────────────────

/** One ActiveX scan, flattened out of `BcaMetric`'s nested vitals/
 *  bodyComposition sub-documents. Every field is nullable because the device
 *  does not always report every measure. */
export interface BodySnapshot {
	recordedAt: string;
	weightKg: number | null;
	bmi: number | null;
	bodyFatPercent: number | null;
	skeletalMuscleMassKg: number | null;
	visceralFat: number | null;
	basalMetabolicRateCal: number | null;
	bodyAge: number | null;
	totalBodyWaterL: number | null;
}

export interface BodySeriesPoint {
	recordedAt: string;
	weightKg: number | null;
	bodyFatPercent: number | null;
	skeletalMuscleMassKg: number | null;
}

export interface BodyDeltas {
	weightKg: number | null;
	bodyFatPercent: number | null;
	skeletalMuscleMassKg: number | null;
	bodyAge: number | null;
	totalBodyWaterL: number | null;
}

export interface BodyBlock {
	hasData: boolean;
	scanCount: number;
	/** Most recent scan. */
	latest: BodySnapshot | null;
	/** First scan on file — the thing `deltas` measures against. Deliberately
	 *  not "the previous period": scans are irregular (typically 3-4 a
	 *  quarter), so a period-clamped comparison would be empty for most
	 *  members most of the time. */
	baseline: BodySnapshot | null;
	deltas: BodyDeltas;
	/** Every scan on file, oldest first — NOT clamped to the selected period,
	 *  for the same reason. The card states the scan count so the member can
	 *  see the trend is not period-filtered. */
	series: BodySeriesPoint[];
}

// ── Training ────────────────────────────────────────────────────────────

export interface TrainingWeekPoint {
	/** Monday (UTC) of the ISO week this bucket covers. */
	weekStart: string;
	sessions: number;
	volumeKg: number;
}

export interface MuscleSplitSlice {
	group: string;
	volumeKg: number;
	sets: number;
	percent: number;
}

export interface TrainingTotals {
	sessions: number;
	totalSets: number;
	totalVolumeKg: number;
	caloriesBurned: number;
}

export interface TrainingBlock extends TrainingTotals {
	hasData: boolean;
	avgDurationMinutes: number | null;
	/** Same totals over the equal-length window immediately before this one. */
	previous: TrainingTotals;
	weekly: TrainingWeekPoint[];
	muscleSplit: MuscleSplitSlice[];
}

// ── Nutrition ───────────────────────────────────────────────────────────

export interface NutritionDayPoint {
	date: string;
	consumedKcal: number;
	plannedKcal: number;
	/** False for a day with no diary entry. The client draws these as a
	 *  distinct empty bar — never as a zero, which would read as "ate
	 *  nothing". */
	logged: boolean;
}

export interface MacroPair {
	consumed: number;
	planned: number;
}

export interface NutritionBlock {
	hasData: boolean;
	daysLogged: number;
	daysInPeriod: number;
	/** Averaged over LOGGED days only — dividing by the full period would
	 *  quietly punish a member for not logging, which is a different fact and
	 *  is already reported as `daysLogged`. */
	avgConsumedKcal: number;
	avgPlannedKcal: number;
	avgCalorieAdherencePct: number;
	macros: {
		proteinG: MacroPair;
		carbsG: MacroPair;
		fatG: MacroPair;
	};
	previous: {
		daysLogged: number;
		avgConsumedKcal: number;
		avgCalorieAdherencePct: number;
	};
	/** Every day in the period, oldest first, including unlogged ones. */
	daily: NutritionDayPoint[];
}

// ── Consistency ─────────────────────────────────────────────────────────

export interface ConsistencyDayPoint {
	/** IST calendar day, `YYYY-MM-DD`. */
	date: string;
	visits: number;
	minutes: number | null;
}

export interface ConsistencyBlock {
	hasData: boolean;
	/** Computed over the member's FULL visit history, not the selected
	 *  period — a streak clipped at the window edge is not a streak. */
	currentStreak: number;
	longestStreak: number;
	visitsInPeriod: number;
	daysVisitedInPeriod: number;
	previousDaysVisited: number;
	days: ConsistencyDayPoint[];
}

// ── Score ───────────────────────────────────────────────────────────────

export type ScorePillarKey = "training" | "body" | "nutrition" | "consistency";

export interface ScorePillar {
	key: ScorePillarKey;
	value: number;
	hasData: boolean;
}

export interface ScoreBlock {
	hasData: boolean;
	value: number | null;
	/** This period's score minus the same computation over the preceding
	 *  window. Null when the preceding window has too little data to score. */
	delta: number | null;
	pillars: ScorePillar[];
}

// ── Insights ────────────────────────────────────────────────────────────

export type InsightTone = "positive" | "attention" | "neutral";

export interface Insight {
	code: string;
	tone: InsightTone;
	text: string;
	values: Record<string, number | string>;
}

// ── Next ────────────────────────────────────────────────────────────────

export interface UpcomingAppointment {
	kind: "nutritionist" | "sports_scientist" | "trainer" | "doctor";
	at: string;
	startTime: string | null;
	withName: string | null;
	mode: string | null;
	bookingId: string;
}

export interface NextBlock {
	/** Informational only. Scans are walk-in and have no cadence, so this
	 *  block deliberately carries no "due" date and no booking prompt. */
	lastScanAt: string | null;
	daysSinceLastScan: number | null;
	upcoming: UpcomingAppointment[];
}

// ── Envelope ────────────────────────────────────────────────────────────

export interface UserAnalyticsResponse {
	period: AnalyticsPeriodInfo;
	score: ScoreBlock;
	body: BodyBlock;
	training: TrainingBlock;
	nutrition: NutritionBlock;
	consistency: ConsistencyBlock;
	insights: Insight[];
	next: NextBlock;
}
