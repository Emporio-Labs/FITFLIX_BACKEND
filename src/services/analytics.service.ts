/**
 * Builds the `GET /analytics/me` payload — the Progress screen's only network
 * call.
 *
 * Query budget: one read per collection, not one per card. Each builder below
 * fetches the CURRENT window and the equal-length window before it in a single
 * query, then splits the rows in JS. That is what makes every `delta` and
 * `previous` on the payload free rather than doubling the round trips.
 *
 * Two different day boundaries are in play, deliberately:
 *   * Workout sessions and nutrition rollups are keyed to UTC midnight by the
 *     writers that create them, so they are bucketed in UTC here.
 *   * Gym visits are real timestamps and are bucketed by IST calendar day, the
 *     same way `computeStreaks` does — otherwise anyone training after 6:30pm
 *     lands in tomorrow and the heatmap disagrees with the streak beside it.
 */

import mongoose from "mongoose";
import BcaMetric from "../models/BcaMetric";
import {
	AppointmentBookingStatus,
	ExpertType,
	NutritionistBookingStatus,
	WorkoutSessionStatus,
} from "../models/Enums";
import Exercise from "../models/Exercise";
import ExpertAppointment from "../models/ExpertAppointment";
import GymVisit from "../models/GymVisit";
import NutritionistBooking from "../models/NutritionistBooking";
import NutritionAdherenceDaily from "../models/nutrition-adherence.model";
import UserNutritionPlan from "../models/nutrition-plan.model";
import SetLog from "../models/SetLog";
import WorkoutExercise from "../models/WorkoutExercise";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import WorkoutSession from "../models/WorkoutSession";
import type {
	AnalyticsPeriodKey,
	BodyBlock,
	BodySnapshot,
	ConsistencyBlock,
	ConsistencyDayPoint,
	MuscleSplitSlice,
	NutritionBlock,
	NutritionDayPoint,
	TrainingBlock,
	TrainingTotals,
	UpcomingAppointment,
	UserAnalyticsResponse,
} from "../types/analytics";
import { PERIOD_DAYS } from "../types/analytics";
import { buildInsights } from "../utils/analytics-insights";
import {
	buildScore,
	DEFAULT_WEEKLY_SESSION_TARGET,
} from "../utils/fitflix-score";
import { computeStreaks, toISTDateString } from "../utils/streaks";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard ceiling on scans returned in `body.series`. A member with more than
 *  this many has been scanning for years; the chart cannot render them anyway. */
const MAX_SCANS = 200;

/** Matches the cap `GET /gym-visits/me` already uses, so both endpoints
 *  compute streaks over the same slice of history. */
const MAX_VISITS = 500;

/**
 * Days of the nutrition diary sent to the client.
 *
 * The full period is walked server-side — `daysLogged`, the averages and the
 * weekday-clustering insight rule all need every day — but the client draws
 * seven bars. Sending all 365 made `nutrition.daily` 91% of a year-view
 * payload (25.9 KB of 28.4 KB), so a member on a slow connection was waiting
 * on 358 days that would never be rendered. Fourteen leaves headroom for a
 * week-over-week comparison without putting the array back in charge of the
 * payload size.
 *
 * The aggregate fields carry the truth the trimmed list no longer can:
 * `daysLogged` and `daysInPeriod` are still computed over the whole window.
 */
const NUTRITION_DAILY_WINDOW = 14;

const utcMidnight = (value: Date): Date =>
	new Date(
		Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
	);

const toIsoDay = (value: Date): string => value.toISOString().slice(0, 10);

const round = (n: number, places = 1): number => {
	const f = 10 ** places;
	return Math.round(n * f) / f;
};

const nullableNumber = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const diff = (a: number | null, b: number | null): number | null =>
	a === null || b === null ? null : round(a - b, 1);

/** Monday (UTC) of the ISO week containing [value]. */
const weekStartOf = (value: Date): Date => {
	const day = utcMidnight(value);
	const weekday = day.getUTCDay();
	const offset = weekday === 0 ? 6 : weekday - 1;
	return new Date(day.getTime() - offset * DAY_MS);
};

interface Window {
	/** Start of the current period. */
	from: Date;
	/** Exclusive end — midnight tomorrow, so today counts. */
	to: Date;
	/** Start of the equal-length window before `from`. */
	prevFrom: Date;
	days: number;
}

const resolveWindow = (period: AnalyticsPeriodKey): Window => {
	const days = PERIOD_DAYS[period];
	const to = new Date(utcMidnight(new Date()).getTime() + DAY_MS);
	const from = new Date(to.getTime() - days * DAY_MS);
	return { from, to, prevFrom: new Date(from.getTime() - days * DAY_MS), days };
};

// ── Body ────────────────────────────────────────────────────────────────

const snapshotOf = (scan: Record<string, any>): BodySnapshot => {
	const vitals = scan.vitals ?? {};
	const comp = scan.bodyComposition ?? {};
	return {
		recordedAt: new Date(scan.recordedAt).toISOString(),
		weightKg: nullableNumber(vitals.weight_kg),
		bmi: nullableNumber(vitals.bmi),
		bodyFatPercent: nullableNumber(comp.body_fat_percent),
		skeletalMuscleMassKg: nullableNumber(comp.skeletal_muscle_mass_kg),
		visceralFat: nullableNumber(comp.visceral_fat),
		basalMetabolicRateCal: nullableNumber(comp.basal_metabolic_rate_cal),
		bodyAge: nullableNumber(comp.body_age),
		totalBodyWaterL: nullableNumber(comp.total_body_water_L),
	};
};

/**
 * Every scan on file, NOT clamped to the selected period.
 *
 * Scans are irregular — typically three or four a quarter — so clamping would
 * leave most members staring at an empty chart on a 7d view. The card states
 * the scan count instead, so nobody mistakes this for period-filtered data.
 */
const buildBody = async (
	userId: mongoose.Types.ObjectId,
): Promise<BodyBlock> => {
	const scans = await BcaMetric.find({ userId })
		.sort({ recordedAt: 1 })
		.limit(MAX_SCANS)
		.lean();

	const empty: BodyBlock = {
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
	if (scans.length === 0) return empty;

	const snapshots = scans.map(snapshotOf);
	// Guarded by the length check above; asserted so the whole block below
	// does not have to re-narrow on every field access.
	const baseline = snapshots[0] as BodySnapshot;
	const latest = snapshots[snapshots.length - 1] as BodySnapshot;

	return {
		hasData: true,
		scanCount: snapshots.length,
		latest,
		baseline,
		// A single scan is a measurement, not a trend — no invented deltas.
		deltas:
			snapshots.length < 2
				? empty.deltas
				: {
						weightKg: diff(latest.weightKg, baseline.weightKg),
						bodyFatPercent: diff(
							latest.bodyFatPercent,
							baseline.bodyFatPercent,
						),
						skeletalMuscleMassKg: diff(
							latest.skeletalMuscleMassKg,
							baseline.skeletalMuscleMassKg,
						),
						bodyAge: diff(latest.bodyAge, baseline.bodyAge),
						totalBodyWaterL: diff(
							latest.totalBodyWaterL,
							baseline.totalBodyWaterL,
						),
					},
		series: snapshots.map((s) => ({
			recordedAt: s.recordedAt,
			weightKg: s.weightKg,
			bodyFatPercent: s.bodyFatPercent,
			skeletalMuscleMassKg: s.skeletalMuscleMassKg,
		})),
	};
};

// ── Training ────────────────────────────────────────────────────────────

interface TrainingRow {
	sessionId: string;
	date: Date;
	durationMinutes: number | null;
	muscleGroups: string[];
	caloriesPerSet: number;
	setCount: number;
	volumeKg: number;
}

/**
 * One aggregation covering both windows.
 *
 * `getMyStats` does the equivalent as four sequential `find()`s plus a JS
 * loop; that is fine for its hardcoded Mon-Sun week but would pull a year of
 * set logs into memory here. Every `$lookup` below lands on an existing index
 * (`{userId,date,status}`, `{sessionId,orderIndex}`, `{workoutExerciseId,
 * setNumber}`), so no new indexes are needed.
 *
 * `preserveNullAndEmptyArrays` on the unwind keeps sessions that have no
 * exercises logged — they still count as a session attended.
 */
const fetchTrainingRows = async (
	userId: mongoose.Types.ObjectId,
	window: Window,
): Promise<TrainingRow[]> => {
	const rows = await WorkoutSession.aggregate([
		{
			$match: {
				userId,
				status: WorkoutSessionStatus.Completed,
				isDeleted: { $ne: true },
				date: { $gte: window.prevFrom, $lt: window.to },
			},
		},
		{
			$lookup: {
				from: WorkoutExercise.collection.name,
				localField: "_id",
				foreignField: "sessionId",
				as: "we",
			},
		},
		{ $unwind: { path: "$we", preserveNullAndEmptyArrays: true } },
		{
			$lookup: {
				from: SetLog.collection.name,
				let: { weId: "$we._id" },
				pipeline: [
					{
						$match: {
							$expr: { $eq: ["$workoutExerciseId", "$$weId"] },
							isWarmup: false,
						},
					},
					{ $project: { actualReps: 1, actualWeightKg: 1 } },
				],
				as: "sets",
			},
		},
		{
			$lookup: {
				from: Exercise.collection.name,
				localField: "we.exerciseId",
				foreignField: "_id",
				as: "ex",
			},
		},
		{
			$project: {
				_id: 0,
				sessionId: { $toString: "$_id" },
				date: "$date",
				durationMinutes: {
					$cond: [
						{ $and: ["$completedAt", "$startedAt"] },
						{
							$divide: [{ $subtract: ["$completedAt", "$startedAt"] }, 60000],
						},
						null,
					],
				},
				muscleGroups: {
					$ifNull: [{ $arrayElemAt: ["$ex.muscleGroups", 0] }, []],
				},
				caloriesPerSet: {
					$ifNull: [{ $arrayElemAt: ["$ex.caloriesPerSet", 0] }, 0],
				},
				setCount: { $size: "$sets" },
				volumeKg: {
					$sum: {
						$map: {
							input: "$sets",
							as: "s",
							in: {
								$multiply: [
									{ $ifNull: ["$$s.actualWeightKg", 0] },
									{ $ifNull: ["$$s.actualReps", 0] },
								],
							},
						},
					},
				},
			},
		},
	]);

	return rows as TrainingRow[];
};

const totalsOf = (rows: TrainingRow[]): TrainingTotals => {
	const sessions = new Set(rows.map((r) => r.sessionId)).size;
	let totalSets = 0;
	let totalVolumeKg = 0;
	let caloriesBurned = 0;
	for (const row of rows) {
		totalSets += row.setCount;
		totalVolumeKg += row.volumeKg;
		caloriesBurned += row.caloriesPerSet * row.setCount;
	}
	return {
		sessions,
		totalSets,
		totalVolumeKg: Math.round(totalVolumeKg),
		caloriesBurned: Math.round(caloriesBurned),
	};
};

/**
 * Volume attributed to muscle groups.
 *
 * An exercise tagged with several groups splits its volume evenly across them,
 * so the percentages always total 100 rather than double-counting a compound
 * lift. `FullBody` is expanded the same way across the six real groups — it is
 * a tag, not a body part, and leaving it as its own slice would put a quarter
 * of a member's volume under a label that names nothing they trained.
 */
const REAL_MUSCLE_GROUPS = [
	"Chest",
	"Back",
	"Legs",
	"Shoulders",
	"Arms",
	"Core",
];

const muscleSplitOf = (rows: TrainingRow[]): MuscleSplitSlice[] => {
	const volume = new Map<string, number>();
	const sets = new Map<string, number>();

	for (const row of rows) {
		if (row.volumeKg <= 0 && row.setCount <= 0) continue;
		const groups = (row.muscleGroups ?? []).flatMap((g) =>
			g === "FullBody" ? REAL_MUSCLE_GROUPS : [g],
		);
		const unique = [...new Set(groups)];
		if (unique.length === 0) continue;

		const volumeShare = row.volumeKg / unique.length;
		const setShare = row.setCount / unique.length;
		for (const group of unique) {
			volume.set(group, (volume.get(group) ?? 0) + volumeShare);
			sets.set(group, (sets.get(group) ?? 0) + setShare);
		}
	}

	// `percent` is a share of WORKING SETS, not of tonnage.
	//
	// Splitting by volume looks more precise and is quietly wrong: a plank, a
	// push-up, a hanging leg raise all carry zero external load, so every
	// bodyweight movement contributes 0 kg. A member doing serious core work
	// would read as "Core 0%" — and the neglected-group insight would fire at
	// them for training the thing they actually trained. Sets are the one
	// denominator loaded and bodyweight work share honestly.
	//
	// `volumeKg` is still reported per group for the members who want it.
	const totalSets = [...sets.values()].reduce((sum, v) => sum + v, 0);
	if (totalSets <= 0) return [];

	return [...sets.entries()]
		.map(([group, groupSets]) => ({
			group,
			volumeKg: Math.round(volume.get(group) ?? 0),
			sets: Math.round(groupSets),
			percent: round((groupSets / totalSets) * 100, 1),
		}))
		.sort((a, b) => b.percent - a.percent);
};

const buildTraining = (
	rows: TrainingRow[],
	window: Window,
): { block: TrainingBlock; previousMuscleSplit: MuscleSplitSlice[] } => {
	const current = rows.filter((r) => new Date(r.date) >= window.from);
	const previous = rows.filter((r) => new Date(r.date) < window.from);

	const totals = totalsOf(current);

	// Session duration lives on the session, not the row — dedupe before
	// averaging or a 6-exercise session counts its duration six times.
	const durations = new Map<string, number>();
	for (const row of current) {
		if (row.durationMinutes !== null && row.durationMinutes > 0) {
			durations.set(row.sessionId, row.durationMinutes);
		}
	}
	const avgDurationMinutes =
		durations.size === 0
			? null
			: Math.round(
					[...durations.values()].reduce((sum, d) => sum + d, 0) /
						durations.size,
				);

	const weeklyMap = new Map<
		string,
		{ sessions: Set<string>; volumeKg: number }
	>();
	for (const row of current) {
		const key = toIsoDay(weekStartOf(new Date(row.date)));
		const bucket = weeklyMap.get(key) ?? { sessions: new Set(), volumeKg: 0 };
		bucket.sessions.add(row.sessionId);
		bucket.volumeKg += row.volumeKg;
		weeklyMap.set(key, bucket);
	}

	const weekly = [...weeklyMap.entries()]
		.map(([weekStart, bucket]) => ({
			weekStart,
			sessions: bucket.sessions.size,
			volumeKg: Math.round(bucket.volumeKg),
		}))
		.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

	return {
		block: {
			hasData: totals.sessions > 0,
			...totals,
			avgDurationMinutes,
			previous: totalsOf(previous),
			weekly,
			muscleSplit: muscleSplitOf(current),
		},
		previousMuscleSplit: muscleSplitOf(previous),
	};
};

// ── Nutrition ───────────────────────────────────────────────────────────

/**
 * Reads the materialized daily rollup rather than raw meal logs — it is
 * recomputed on every meal-log mutation and indexed `{userId, date}`, so a
 * year of nutrition is one cheap range query.
 *
 * Plan resolution mirrors `getMyAdherence` exactly (latest plan, else the
 * plan-less rollup). If it diverged, the Progress screen and the Nutrition tab
 * would quote different calorie numbers for the same day.
 */
const buildNutrition = async (
	userId: mongoose.Types.ObjectId,
	window: Window,
): Promise<NutritionBlock> => {
	const latestPlan = await UserNutritionPlan.findOne({ userId })
		.sort({ createdAt: -1 })
		.select("_id")
		.lean();
	const planId = latestPlan ? latestPlan._id : null;

	const rollups = await NutritionAdherenceDaily.find({
		userId,
		planId,
		date: { $gte: window.prevFrom, $lt: window.to },
	})
		.sort({ date: 1 })
		.lean();

	const byDay = new Map<string, (typeof rollups)[number]>();
	for (const row of rollups) {
		byDay.set(toIsoDay(new Date(row.date)), row);
	}

	const isLogged = (row?: (typeof rollups)[number]): boolean =>
		!!row &&
		((row.loggedMeals ?? 0) > 0 || (row.consumedCaloriesKcal ?? 0) > 0);

	// Walk every calendar day so unlogged days are present and explicit,
	// rather than absent and indistinguishable from a zero-calorie day.
	const daily: NutritionDayPoint[] = [];
	for (let t = window.from.getTime(); t < window.to.getTime(); t += DAY_MS) {
		const key = toIsoDay(new Date(t));
		const row = byDay.get(key);
		daily.push({
			date: key,
			consumedKcal: Math.round(row?.consumedCaloriesKcal ?? 0),
			plannedKcal: Math.round(row?.plannedCaloriesKcal ?? 0),
			logged: isLogged(row),
		});
	}

	const currentRows = rollups.filter(
		(r) => new Date(r.date) >= window.from && isLogged(r),
	);
	const previousRows = rollups.filter(
		(r) => new Date(r.date) < window.from && isLogged(r),
	);

	const mean = (values: number[]): number =>
		values.length === 0
			? 0
			: Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);

	const macroSum = (
		rows: typeof rollups,
		bucket: "consumedMacros" | "plannedMacros",
		key: "proteinG" | "carbsG" | "fatG",
	): number =>
		rows.length === 0
			? 0
			: Math.round(
					rows.reduce((sum, r) => sum + ((r[bucket] as any)?.[key] ?? 0), 0) /
						rows.length,
				);

	return {
		hasData: currentRows.length > 0,
		daysLogged: currentRows.length,
		daysInPeriod: window.days,
		// Averaged over LOGGED days only. Dividing by the full period would
		// blend "ate less" with "did not write it down" — two different facts,
		// and the second one is already reported as daysLogged.
		avgConsumedKcal: mean(currentRows.map((r) => r.consumedCaloriesKcal ?? 0)),
		avgPlannedKcal: mean(currentRows.map((r) => r.plannedCaloriesKcal ?? 0)),
		avgCalorieAdherencePct: mean(
			currentRows.map((r) => r.calorieAdherencePct ?? 0),
		),
		macros: {
			proteinG: {
				consumed: macroSum(currentRows, "consumedMacros", "proteinG"),
				planned: macroSum(currentRows, "plannedMacros", "proteinG"),
			},
			carbsG: {
				consumed: macroSum(currentRows, "consumedMacros", "carbsG"),
				planned: macroSum(currentRows, "plannedMacros", "carbsG"),
			},
			fatG: {
				consumed: macroSum(currentRows, "consumedMacros", "fatG"),
				planned: macroSum(currentRows, "plannedMacros", "fatG"),
			},
		},
		previous: {
			daysLogged: previousRows.length,
			avgConsumedKcal: mean(
				previousRows.map((r) => r.consumedCaloriesKcal ?? 0),
			),
			avgCalorieAdherencePct: mean(
				previousRows.map((r) => r.calorieAdherencePct ?? 0),
			),
		},
		daily,
	};
};

// ── Consistency ─────────────────────────────────────────────────────────

/**
 * Streaks are computed over the member's FULL visit history, not the selected
 * period — a streak clipped at the window edge is not a streak. The heatmap
 * and the in-period counts are then filtered from the same fetch.
 */
const buildConsistency = async (
	userId: mongoose.Types.ObjectId,
	window: Window,
): Promise<ConsistencyBlock> => {
	const visits = await GymVisit.find({ userId })
		.sort({ checkInAt: -1 })
		.limit(MAX_VISITS)
		.select("checkInAt durationMinutes")
		.lean();

	const uniqueDays = Array.from(
		new Set(visits.map((v) => toISTDateString(new Date(v.checkInAt)))),
	).sort((a, b) => b.localeCompare(a));

	const { currentStreak, longestStreak } = computeStreaks(uniqueDays);

	const inWindow = (v: (typeof visits)[number], start: Date, end: Date) => {
		const at = new Date(v.checkInAt).getTime();
		return at >= start.getTime() && at < end.getTime();
	};

	const currentVisits = visits.filter((v) =>
		inWindow(v, window.from, window.to),
	);
	const previousVisits = visits.filter((v) =>
		inWindow(v, window.prevFrom, window.from),
	);

	const dayMap = new Map<string, ConsistencyDayPoint>();
	for (const visit of currentVisits) {
		const key = toISTDateString(new Date(visit.checkInAt));
		const existing = dayMap.get(key) ?? { date: key, visits: 0, minutes: null };
		existing.visits += 1;
		if (typeof visit.durationMinutes === "number") {
			existing.minutes = (existing.minutes ?? 0) + visit.durationMinutes;
		}
		dayMap.set(key, existing);
	}

	const daysVisitedInPeriod = dayMap.size;
	const previousDaysVisited = new Set(
		previousVisits.map((v) => toISTDateString(new Date(v.checkInAt))),
	).size;

	return {
		hasData: visits.length > 0,
		currentStreak,
		longestStreak,
		visitsInPeriod: currentVisits.length,
		daysVisitedInPeriod,
		previousDaysVisited,
		days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
	};
};

// ── Next ────────────────────────────────────────────────────────────────

const EXPERT_KIND: Record<string, UpcomingAppointment["kind"]> = {
	[ExpertType.SportsScientist]: "sports_scientist",
	[ExpertType.Nutritionist]: "nutritionist",
	[ExpertType.Trainer]: "trainer",
	[ExpertType.Doctor]: "doctor",
};

/**
 * Confirmed and pending appointments still ahead of now, nearest first.
 *
 * Body scans are walk-in — no cadence, no booking — so this block deliberately
 * carries no "scan due" date and no prompt to book one. `lastScanAt` is
 * reported as plain information and nothing more.
 */
const buildNext = async (
	userId: mongoose.Types.ObjectId,
	lastScanAt: string | null,
): Promise<UserAnalyticsResponse["next"]> => {
	const now = new Date();

	const [nutritionist, expert] = await Promise.all([
		NutritionistBooking.find({
			userId,
			bookingDate: { $gte: now },
			status: {
				$in: [
					NutritionistBookingStatus.PENDING,
					NutritionistBookingStatus.ACCEPTED,
				],
			},
		})
			.sort({ bookingDate: 1 })
			.limit(5)
			.lean(),
		ExpertAppointment.find({
			userId,
			appointmentDate: { $gte: now },
			bookingStatus: {
				$in: [
					AppointmentBookingStatus.Pending,
					AppointmentBookingStatus.Confirmed,
					AppointmentBookingStatus.Rescheduled,
				],
			},
		})
			.sort({ appointmentDate: 1 })
			.limit(5)
			.lean(),
	]);

	const upcoming: UpcomingAppointment[] = [
		...nutritionist.map((b: any) => ({
			kind: "nutritionist" as const,
			at: new Date(b.bookingDate).toISOString(),
			startTime: b.startTime ?? null,
			withName: b.assignedNutritionistName ?? null,
			mode: b.appointmentMode ?? null,
			bookingId: String(b._id),
		})),
		...expert.map((b: any) => ({
			kind: EXPERT_KIND[b.expertType] ?? ("trainer" as const),
			at: new Date(b.appointmentDate).toISOString(),
			startTime: b.startTime ?? null,
			withName: b.assignedExpertName ?? null,
			mode: b.appointmentMode ?? null,
			bookingId: String(b._id),
		})),
	]
		.sort((a, b) => a.at.localeCompare(b.at))
		.slice(0, 3);

	const daysSinceLastScan =
		lastScanAt === null
			? null
			: Math.floor((Date.now() - new Date(lastScanAt).getTime()) / DAY_MS);

	return { lastScanAt, daysSinceLastScan, upcoming };
};

// ── Assembly ────────────────────────────────────────────────────────────

/**
 * Sessions per week the member's active plan calls for — the training score's
 * denominator. Rest days do not count. Falls back to a flat target when they
 * have no assigned plan, so an unassigned member is still scoreable.
 */
const resolveWeeklySessionTarget = async (
	userId: mongoose.Types.ObjectId,
): Promise<number> => {
	const assignment = await WorkoutPlanAssignment.findOne({
		userId,
		status: "active",
		isDeleted: { $ne: true },
	})
		.sort({ updatedAt: -1 })
		.select("userDays")
		.lean();

	const days = assignment?.userDays ?? [];
	if (days.length === 0) return DEFAULT_WEEKLY_SESSION_TARGET;

	const trainingDays = days.filter((d) => !d.isRestDay).length;
	if (trainingDays === 0) return DEFAULT_WEEKLY_SESSION_TARGET;

	// A plan cycle is not always 7 days — normalise to a weekly rate.
	return round((trainingDays / days.length) * 7, 1);
};

export const buildUserAnalytics = async (
	rawUserId: string,
	period: AnalyticsPeriodKey,
): Promise<UserAnalyticsResponse> => {
	const userId = new mongoose.Types.ObjectId(rawUserId);
	const window = resolveWindow(period);

	const [body, trainingRows, nutrition, consistency, weeklySessionTarget] =
		await Promise.all([
			buildBody(userId),
			fetchTrainingRows(userId, window),
			buildNutrition(userId, window),
			buildConsistency(userId, window),
			resolveWeeklySessionTarget(userId),
		]);

	const { block: training, previousMuscleSplit } = buildTraining(
		trainingRows,
		window,
	);

	const score = buildScore({
		days: window.days,
		training,
		body,
		nutrition,
		consistency,
		weeklySessionTarget,
	});

	// The delta is the same computation over the preceding window. Training
	// and nutrition each expose their previous totals; consistency exposes its
	// previous day count. Body is excluded — scans are not period-bound, so
	// re-scoring them against a past window would compare a value to itself.
	const previousScore = buildScore({
		days: window.days,
		training: {
			...training,
			...training.previous,
			hasData: training.previous.sessions > 0,
		},
		body: { ...body, hasData: false, scanCount: 0 },
		nutrition: {
			...nutrition,
			hasData: nutrition.previous.daysLogged > 0,
			daysLogged: nutrition.previous.daysLogged,
			avgCalorieAdherencePct: nutrition.previous.avgCalorieAdherencePct,
		},
		consistency: {
			...consistency,
			hasData: consistency.previousDaysVisited > 0,
			daysVisitedInPeriod: consistency.previousDaysVisited,
		},
		weeklySessionTarget,
	});

	if (score.hasData && previousScore.hasData) {
		score.delta = (score.value ?? 0) - (previousScore.value ?? 0);
	}

	const next = await buildNext(userId, body.latest?.recordedAt ?? null);

	// Insights run against the FULL day list — the weekday-clustering rule
	// needs every unlogged day to find the pattern — and only then is the
	// list trimmed for the wire.
	const insights = buildInsights({
		body,
		training,
		nutrition,
		consistency,
		previousMuscleSplit,
	});

	return {
		period: {
			key: period,
			from: window.from.toISOString(),
			to: window.to.toISOString(),
			days: window.days,
		},
		score,
		body,
		training,
		nutrition: {
			...nutrition,
			daily: nutrition.daily.slice(-NUTRITION_DAILY_WINDOW),
		},
		consistency,
		insights,
		next,
	};
};
