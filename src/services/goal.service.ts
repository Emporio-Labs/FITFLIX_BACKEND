import mongoose from "mongoose";
import BcaMetric from "../models/BcaMetric";
import { GoalStatus, GoalType } from "../models/Enums";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import MemberGoal from "../models/MemberGoal";
import NutritionProgress from "../models/nutrition-progress.model";
import type {
	CreateGoalInput,
	UpdateGoalInput,
} from "../validators/goal.validator";

export async function ensureDefaultGoals(userId: string): Promise<void> {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const count = await MemberGoal.countDocuments({
		userId: userObjectId,
		status: GoalStatus.Active,
	});
	if (count > 0) return;

	// Check onboarding intake for target weight and health markers
	const [intakeGoals, intakeMarkers, latestBca, latestProgress] = await Promise.all([
		HealthGoals.findOne({ userId: userObjectId }).lean(),
		HealthMarkers.findOne({ userId: userObjectId }).lean(),
		BcaMetric.findOne({ userId: userObjectId }).sort({ recordedAt: -1 }).lean(),
		NutritionProgress.findOne({ userId: userObjectId, weightKg: { $ne: null } })
			.sort({ recordedAt: -1 })
			.lean(),
	]);

	// Ground truth baseline weight priority: Latest Progress Check-in -> Latest BCA scan vitals -> Onboarding Health Markers -> 75.0 fallback
	const baselineWeight =
		latestProgress?.weightKg ??
		latestBca?.vitals?.weight_kg ??
		intakeMarkers?.weight ??
		75.0;

	const targetWeight =
		intakeGoals?.targetWeight ?? Math.max(baselineWeight - 4, 60.0);

	const currentWeight =
		latestProgress?.weightKg ??
		latestBca?.vitals?.weight_kg ??
		baselineWeight;

	const defaultGoals = [
		{
			userId: userObjectId,
			type: GoalType.Weight,
			title: "Target Weight & Recomposition",
			description: "Progress towards your target body weight",
			startValue: baselineWeight,
			currentValue: currentWeight,
			targetValue: targetWeight,
			unit: "kg",
			status: GoalStatus.Active,
		},
		{
			userId: userObjectId,
			type: GoalType.Water,
			title: "Daily Longevity Hydration",
			description: "Optimal cellular hydration volume",
			startValue: 0,
			currentValue: 0,
			targetValue: 3000,
			unit: "ml",
			status: GoalStatus.Active,
		},
		{
			userId: userObjectId,
			type: GoalType.Nutrition,
			title: "Daily Calorie Target",
			description: "Target energy intake per prescribed plan",
			startValue: 0,
			currentValue: 0,
			targetValue: 2200,
			unit: "kcal",
			status: GoalStatus.Active,
		},
	];

	await MemberGoal.insertMany(defaultGoals);
}

/**
 * Synchronizes the active WEIGHT goal's currentValue when a new weigh-in is
 * recorded or an ActiveX BCA scan is ingested.
 */
export async function syncWeightGoal(
	userId: string | mongoose.Types.ObjectId,
	currentWeightKg: number,
): Promise<void> {
	if (!currentWeightKg || currentWeightKg <= 0) return;
	const userObjectId =
		typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

	await MemberGoal.updateMany(
		{ userId: userObjectId, type: GoalType.Weight, status: GoalStatus.Active },
		{ $set: { currentValue: currentWeightKg } },
	);
}

export async function getMyGoals(userId: string) {
	await ensureDefaultGoals(userId);

	const userObjectId = new mongoose.Types.ObjectId(userId);
	const goals = await MemberGoal.find({
		userId: userObjectId,
		status: GoalStatus.Active,
	})
		.sort({ createdAt: 1 })
		.lean();

	return goals.map((g) => {
		let progressPct = 0;
		if (g.type === GoalType.Weight) {
			const totalDelta = Math.abs(g.startValue - g.targetValue);
			const currentDelta = Math.abs(g.startValue - g.currentValue);
			progressPct =
				totalDelta > 0
					? Math.min(100, Math.max(0, Math.round((currentDelta / totalDelta) * 100)))
					: 100;
		} else {
			progressPct =
				g.targetValue > 0
					? Math.min(
							100,
							Math.max(0, Math.round((g.currentValue / g.targetValue) * 100)),
						)
					: 0;
		}

		return {
			id: g._id.toString(),
			type: g.type,
			title: g.title,
			description: g.description,
			startValue: g.startValue,
			currentValue: g.currentValue,
			targetValue: g.targetValue,
			unit: g.unit,
			targetDate: g.targetDate,
			status: g.status,
			progressPct,
		};
	});
}

export async function createGoal(userId: string, input: CreateGoalInput) {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const goal = await MemberGoal.create({
		userId: userObjectId,
		type: input.type,
		title: input.title,
		description: input.description || "",
		startValue: input.startValue,
		currentValue: input.currentValue,
		targetValue: input.targetValue,
		unit: input.unit,
		targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
		status: GoalStatus.Active,
	});

	return goal;
}

export async function updateGoal(
	userId: string,
	goalId: string,
	input: UpdateGoalInput,
) {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const goalObjectId = new mongoose.Types.ObjectId(goalId);

	const updatePayload: Record<string, unknown> = { ...input };
	if (input.targetDate) {
		updatePayload.targetDate = new Date(input.targetDate);
	}

	const goal = await MemberGoal.findOneAndUpdate(
		{ _id: goalObjectId, userId: userObjectId },
		{ $set: updatePayload },
		{ new: true },
	);

	if (!goal) {
		throw new Error("Goal not found");
	}

	return goal;
}
