import mongoose from "mongoose";
import { MealLogSource, MealLogStatus } from "./Enums";
import { macroTotalsSchema } from "./nutrition-shared.schema";

// Actual consumed food. foodId is nullable here — ad-hoc/AI/scan logs may
// not map to a catalog row. Macros are still snapshotted on the item.
const loggedItemSchema = new mongoose.Schema(
	{
		foodId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionFood",
			default: null,
		},
		foodName: { type: String, required: true },
		quantityG: { type: Number, required: true },
		caloriesKcal: { type: Number, required: true },
		proteinG: { type: Number, required: true },
		carbsG: { type: Number, required: true },
		fatG: { type: Number, required: true },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
	},
	{ _id: false },
);

// Links a log back to the prescribed meal so adherence can compare
// consumed vs. planned without guessing.
const plannedMealRefSchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		mealIndex: { type: Number, required: true },
	},
	{ _id: false },
);

const nutritionMealLogSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		planId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "UserNutritionPlan",
			default: null,
		},
		logDate: { type: Date, required: true },
		dayNumber: { type: Number, default: null },
		plannedMealRef: { type: plannedMealRefSchema, default: null },
		status: {
			type: String,
			enum: Object.values(MealLogStatus),
			default: MealLogStatus.Logged,
		},
		consumedAt: { type: Date, default: Date.now },
		items: { type: [loggedItemSchema], default: [] },
		totals: { type: macroTotalsSchema, default: () => ({}) },
		photoUrls: { type: [String], default: [] },
		notes: { type: String, default: "" },
		source: {
			type: String,
			enum: Object.values(MealLogSource),
			default: MealLogSource.Manual,
		},
	},
	{ timestamps: true },
);

nutritionMealLogSchema.index({ userId: 1, logDate: -1 });
nutritionMealLogSchema.index({ planId: 1, logDate: 1 });
nutritionMealLogSchema.index({ userId: 1, planId: 1, logDate: 1 });

export type NutritionMealLogDocument = mongoose.InferSchemaType<
	typeof nutritionMealLogSchema
>;

const NutritionMealLog =
	(mongoose.models
		.NutritionMealLog as mongoose.Model<NutritionMealLogDocument>) ||
	mongoose.model<NutritionMealLogDocument>(
		"NutritionMealLog",
		nutritionMealLogSchema,
	);

export default NutritionMealLog;
