import mongoose from "mongoose";
import { macroTotalsSchema } from "./nutrition-shared.schema";

// Materialized daily rollup. Recomputed on every meal-log mutation so
// dashboards read O(days) instead of aggregating raw logs. The unique
// {userId,planId,date} index makes the upsert idempotent.
const nutritionAdherenceDailySchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		planId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "UserNutritionPlan",
			required: true,
		},
		date: { type: Date, required: true },
		plannedMeals: { type: Number, default: 0 },
		loggedMeals: { type: Number, default: 0 },
		completedMeals: { type: Number, default: 0 },
		plannedCaloriesKcal: { type: Number, default: 0 },
		consumedCaloriesKcal: { type: Number, default: 0 },
		plannedMacros: { type: macroTotalsSchema, default: () => ({}) },
		consumedMacros: { type: macroTotalsSchema, default: () => ({}) },
		mealAdherencePct: { type: Number, default: 0 },
		calorieAdherencePct: { type: Number, default: 0 },
		hydrationMl: { type: Number, default: 0 },
		hydrationGoalMl: { type: Number, default: 0 },
		computedAt: { type: Date, default: Date.now },
	},
	{ timestamps: true },
);

nutritionAdherenceDailySchema.index(
	{ userId: 1, planId: 1, date: 1 },
	{ unique: true },
);
nutritionAdherenceDailySchema.index({ planId: 1, date: 1 });
nutritionAdherenceDailySchema.index({ userId: 1, date: -1 });

export type NutritionAdherenceDailyDocument = mongoose.InferSchemaType<
	typeof nutritionAdherenceDailySchema
>;

const NutritionAdherenceDaily =
	(mongoose.models
		.NutritionAdherenceDaily as mongoose.Model<NutritionAdherenceDailyDocument>) ||
	mongoose.model<NutritionAdherenceDailyDocument>(
		"NutritionAdherenceDaily",
		nutritionAdherenceDailySchema,
	);

export default NutritionAdherenceDaily;
