import mongoose from "mongoose";
import { NutritionGoal } from "../../models/Enums";
import NutritionAdherenceDaily from "../../models/nutrition-adherence.model";
import NutritionMealLog from "../../models/nutrition-meal-log.model";
import UserNutritionPlan from "../../models/nutrition-plan.model";
import type { MacroTargetResult } from "./nutrition-dashboard.service";
import { NutritionServiceError, normalizeToUtcDate } from "./nutrition-errors";
import { getEffectiveMealItems, sumMacros } from "./nutrition-macro.util";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Plans are a repeating cycle of `durationDays`. Returns the 1-based day
// number for a date, or null if the date precedes the plan start or no start is set.
export const computeDayNumber = (
	startDate: Date | null | undefined,
	durationDays: number,
	date: Date,
): number | null => {
	if (!startDate) return null;
	const start = normalizeToUtcDate(startDate).getTime();
	const target = normalizeToUtcDate(date).getTime();
	if (target < start) {
		return null;
	}
	const diffDays = Math.floor((target - start) / MS_PER_DAY);
	const cycle = durationDays > 0 ? durationDays : 1;
	return (diffDays % cycle) + 1;
};

const closenessPct = (planned: number, consumed: number): number => {
	if (planned <= 0) {
		return 0;
	}
	const deviation = Math.abs(consumed - planned) / planned;
	return Math.round(Math.max(0, 1 - deviation) * 100);
};

// Hydration is denormalized into the rollup. Resolved lazily so this
// service does not hard-depend on the hydration model load order.
const getHydrationForDay = async (
	userId: mongoose.Types.ObjectId,
	date: Date,
): Promise<{ totalMl: number; goalMl: number }> => {
	try {
		const { default: NutritionHydrationLog } = await import(
			"../../models/nutrition-hydration.model"
		);
		const doc = await NutritionHydrationLog.findOne({
			userId,
			logDate: date,
		});
		return {
			totalMl: doc?.totalMl ?? 0,
			goalMl: doc?.goalMl ?? 0,
		};
	} catch {
		return { totalMl: 0, goalMl: 0 };
	}
};

// Plan-less "planned" macros, resolved the same 5-tier way the dashboard
// resolves targets for a user (profile -> biometric calc -> weight-only ->
// none) so calorie/protein closeness still means something without a
// prescribed day to compare against. Lazily imported to match the hydration
// lookup above and avoid hard-depending on load order for models this
// service doesn't otherwise need.
const getPlanlessTargets = async (
	userId: mongoose.Types.ObjectId,
): Promise<MacroTargetResult> => {
	try {
		const [
			{ default: NutritionProfile },
			{ default: HealthMarkers },
			{ default: User },
			{ resolveNutritionTargets },
		] = await Promise.all([
			import("../../models/nutrition-profile.model"),
			import("../../models/HealthMarkers"),
			import("../../models/User"),
			import("./nutrition-dashboard.service"),
		]);

		const [nutritionProfile, healthMarkers, user] = await Promise.all([
			NutritionProfile.findOne({ userId }),
			HealthMarkers.findOne({ userId }),
			User.findById(userId),
		]);

		return resolveNutritionTargets(
			null,
			nutritionProfile,
			healthMarkers,
			user,
			nutritionProfile?.goal ?? NutritionGoal.Maintenance,
		);
	} catch {
		return {
			calories: 0,
			protein: 0,
			carbs: 0,
			fat: 0,
			water: 0,
			source: "none",
		};
	}
};

// THE single recompute path. Every meal-log mutation must call this so the
// rollup never drifts from the underlying logs. planId is null for free-form
// diary logging with no nutritionist-assigned plan.
export const recomputeDay = async (
	userId: string | mongoose.Types.ObjectId,
	planId: string | mongoose.Types.ObjectId | null,
	date: Date,
): Promise<void> => {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const planObjectId = planId ? new mongoose.Types.ObjectId(planId) : null;
	const day = normalizeToUtcDate(date);

	let plannedMeals = 0;
	let plannedMacros = sumMacros([]);
	let plannedCaloriesKcal = 0;

	if (planObjectId) {
		const plan = await UserNutritionPlan.findById(planObjectId);
		if (!plan) {
			throw new NutritionServiceError("NOT_FOUND", "Plan not found");
		}

		const dayNumber = computeDayNumber(plan.startDate, plan.durationDays, day);
		const planDay =
			dayNumber === null
				? null
				: plan.days.find((d) => d.dayNumber === dayNumber);
		const plannedMealsArr = planDay?.meals ?? [];

		plannedMeals = plannedMealsArr.length;
		const plannedItems = plannedMealsArr.flatMap((m) =>
			getEffectiveMealItems(m),
		);
		plannedMacros = sumMacros(plannedItems);
		plannedCaloriesKcal = plannedMacros.caloriesKcal;
	} else {
		// No plan: source "planned" macros from the member's profile/biometric
		// target resolution instead of a prescribed day.
		const targets = await getPlanlessTargets(userObjectId);
		plannedCaloriesKcal = targets.calories;
		plannedMacros = {
			caloriesKcal: targets.calories,
			proteinG: targets.protein,
			carbsG: targets.carbs,
			fatG: targets.fat,
			fiberG: 0,
			sugarG: 0,
		};
	}

	const logs = await NutritionMealLog.find({
		userId: userObjectId,
		planId: planObjectId,
		logDate: day,
	});

	const loggedMeals = logs.length;
	const completedMeals = logs.filter((l) => l.status !== "Skipped").length;

	const consumedMacros = sumMacros(
		logs.map((l) => ({
			caloriesKcal: l.totals?.caloriesKcal ?? 0,
			proteinG: l.totals?.proteinG ?? 0,
			carbsG: l.totals?.carbsG ?? 0,
			fatG: l.totals?.fatG ?? 0,
			fiberG: l.totals?.fiberG ?? 0,
			sugarG: l.totals?.sugarG ?? 0,
		})),
	);
	const consumedCaloriesKcal = consumedMacros.caloriesKcal;

	// Meal-count adherence is only meaningful against a prescribed day — a
	// plan-less diary has no "planned meal count" to compare against.
	const mealAdherencePct =
		planObjectId && plannedMeals > 0
			? Math.round(Math.min(1, completedMeals / plannedMeals) * 100)
			: 0;
	const calorieAdherencePct = closenessPct(
		plannedCaloriesKcal,
		consumedCaloriesKcal,
	);
	const proteinAdherencePct = closenessPct(
		plannedMacros.proteinG,
		consumedMacros.proteinG,
	);

	const hydration = await getHydrationForDay(userObjectId, day);

	await NutritionAdherenceDaily.findOneAndUpdate(
		{ userId: userObjectId, planId: planObjectId, date: day },
		{
			userId: userObjectId,
			planId: planObjectId,
			date: day,
			plannedMeals,
			loggedMeals,
			completedMeals,
			plannedCaloriesKcal,
			consumedCaloriesKcal,
			plannedMacros,
			consumedMacros,
			mealAdherencePct,
			calorieAdherencePct,
			proteinAdherencePct,
			hydrationMl: hydration.totalMl,
			hydrationGoalMl: hydration.goalMl,
			computedAt: new Date(),
		},
		{ upsert: true, returnDocument: "after", runValidators: true },
	);
};

export const getDailyAdherence = async (
	userId: string,
	planId: string | null,
	date: Date,
) =>
	NutritionAdherenceDaily.findOne({
		userId: new mongoose.Types.ObjectId(userId),
		planId: planId ? new mongoose.Types.ObjectId(planId) : null,
		date: normalizeToUtcDate(date),
	});

export const getAdherenceRange = async (
	userId: string,
	planId: string | null,
	from: Date,
	to: Date,
) =>
	NutritionAdherenceDaily.find({
		userId: new mongoose.Types.ObjectId(userId),
		planId: planId ? new mongoose.Types.ObjectId(planId) : null,
		date: {
			$gte: normalizeToUtcDate(from),
			$lte: normalizeToUtcDate(to),
		},
	}).sort({ date: 1 });

export const getPlanAdherenceSummary = async (
	planId: string,
	from: Date,
	to: Date,
) => {
	const [summary] = await NutritionAdherenceDaily.aggregate([
		{
			$match: {
				planId: new mongoose.Types.ObjectId(planId),
				date: {
					$gte: normalizeToUtcDate(from),
					$lte: normalizeToUtcDate(to),
				},
			},
		},
		{
			$group: {
				_id: "$planId",
				days: { $sum: 1 },
				avgMealAdherencePct: { $avg: "$mealAdherencePct" },
				avgCalorieAdherencePct: { $avg: "$calorieAdherencePct" },
				totalConsumedKcal: { $sum: "$consumedCaloriesKcal" },
				totalPlannedKcal: { $sum: "$plannedCaloriesKcal" },
			},
		},
	]);

	return (
		summary ?? {
			_id: planId,
			days: 0,
			avgMealAdherencePct: 0,
			avgCalorieAdherencePct: 0,
			totalConsumedKcal: 0,
			totalPlannedKcal: 0,
		}
	);
};

// Aggregates daily rollups into 7-day buckets for weekly summaries.
export const getWeeklyAdherence = async (
	userId: string,
	planId: string | null,
	from: Date,
	to: Date,
) => {
	const days = await getAdherenceRange(userId, planId, from, to);
	const fromMs = normalizeToUtcDate(from).getTime();

	type WeekBucket = {
		weekIndex: number;
		startDate: Date;
		endDate: Date;
		days: number;
		avgMealPct: number;
		avgCaloriePct: number;
		avgProteinPct: number;
		avgWaterPct: number;
	};

	const buckets = new Map<number, { entries: typeof days }>();

	for (const day of days) {
		const diffMs = day.date.getTime() - fromMs;
		const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
		if (!buckets.has(weekIndex)) {
			buckets.set(weekIndex, { entries: [] });
		}
		buckets.get(weekIndex)!.entries.push(day);
	}

	const avg = (arr: number[]) =>
		arr.length === 0
			? 0
			: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);

	const weeks: WeekBucket[] = [];
	for (const [weekIndex, { entries }] of Array.from(buckets.entries()).sort(
		([a], [b]) => a - b,
	)) {
		const weekStartMs = fromMs + weekIndex * 7 * 24 * 60 * 60 * 1000;
		const weekEndMs = weekStartMs + 6 * 24 * 60 * 60 * 1000;
		weeks.push({
			weekIndex,
			startDate: new Date(weekStartMs),
			endDate: new Date(weekEndMs),
			days: entries.length,
			avgMealPct: avg(entries.map((e) => e.mealAdherencePct)),
			avgCaloriePct: avg(entries.map((e) => e.calorieAdherencePct)),
			avgProteinPct: avg(
				entries.map(
					(e) =>
						(e as { proteinAdherencePct?: number }).proteinAdherencePct ?? 0,
				),
			),
			avgWaterPct: avg(
				entries.map((e) =>
					e.hydrationGoalMl > 0
						? Math.min(
								100,
								Math.round((e.hydrationMl / e.hydrationGoalMl) * 100),
							)
						: 0,
				),
			),
		});
	}

	return { weeks };
};

// Idempotent repair tool — rebuilds every rollup day that has logs for a
// plan. Use after migrations or if a write ever bypassed the service.
export const rebuildAdherence = async (planId: string): Promise<number> => {
	const planObjectId = new mongoose.Types.ObjectId(planId);
	const plan = await UserNutritionPlan.findById(planObjectId);
	if (!plan) {
		throw new NutritionServiceError("NOT_FOUND", "Plan not found");
	}

	const distinct = await NutritionMealLog.aggregate<{
		_id: { userId: mongoose.Types.ObjectId; logDate: Date };
	}>([
		{ $match: { planId: planObjectId } },
		{
			$group: {
				_id: { userId: "$userId", logDate: "$logDate" },
			},
		},
	]);

	for (const entry of distinct) {
		await recomputeDay(entry._id.userId, planObjectId, entry._id.logDate);
	}

	return distinct.length;
};

// Sibling to rebuildAdherence for the plan-less rollup: walks every day that
// has a plan-less log for this user and recomputes it. Use after migrations
// or if a diary write ever bypassed the service.
export const rebuildUserAdherence = async (userId: string): Promise<number> => {
	const userObjectId = new mongoose.Types.ObjectId(userId);

	const distinct = await NutritionMealLog.aggregate<{ _id: Date }>([
		{ $match: { userId: userObjectId, planId: null } },
		{ $group: { _id: "$logDate" } },
	]);

	for (const entry of distinct) {
		await recomputeDay(userObjectId, null, entry._id);
	}

	return distinct.length;
};
