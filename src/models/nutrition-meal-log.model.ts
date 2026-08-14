import mongoose from "mongoose";
import { MealLogSource, MealLogStatus, MealType } from "./Enums";
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
		// Display metadata for household-portion logging ("2 rotis"). quantityG
		// stays the canonical value everything else derives from.
		servingLabel: { type: String, default: null },
		servingCount: { type: Number, default: null },
		// Whitelisted micronutrients (config/nutrition-micros.ts), scaled the same way macros are.
		micros: { type: Map, of: Number, default: {} },
	},
	{ _id: false },
);

// Links a log back to the prescribed meal so adherence can compare
// consumed vs. planned without guessing.
const plannedMealRefSchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		mealIndex: { type: Number, required: true },
		// Stable IDs from mealOptionSchema._id. Null for legacy plans or
		// meals without options[]; falls back to the default option.
		selectedOptionId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
		completedOptionId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
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
		// Null for legacy/plan logs that predate this field. markMealCompleted
		// populates it from the prescribed meal; free-form logs set it directly
		// so the diary can group by breakfast/lunch/dinner without a plan.
		mealType: {
			type: String,
			enum: Object.values(MealType),
			default: null,
		},
		plannedMealRef: { type: plannedMealRefSchema, default: null },
		status: {
			type: String,
			enum: Object.values(MealLogStatus),
			default: MealLogStatus.Logged,
		},
		consumedAt: { type: Date, default: Date.now },
		items: { type: [loggedItemSchema], default: [] },
		totals: { type: macroTotalsSchema, default: () => ({}) },
		// Sum of items[].micros for the day's log — mirrors totals above.
		microTotals: { type: Map, of: Number, default: {} },
		photoUrls: { type: [String], default: [] },
		notes: { type: String, default: "" },
		source: {
			type: String,
			enum: Object.values(MealLogSource),
			default: MealLogSource.Manual,
		},
	},
	{ timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

nutritionMealLogSchema.virtual("slot").get(function () {
	return this.mealType;
});

nutritionMealLogSchema.virtual("consumed").get(function () {
	return this.status === MealLogStatus.Logged || (this.status as string) === "completed";
});

nutritionMealLogSchema.virtual("loggedAt").get(function () {
	return this.consumedAt || (this as any).createdAt;
});

nutritionMealLogSchema.virtual("date").get(function () {
	return this.logDate ? this.logDate.toISOString().slice(0, 10) : undefined;
});

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
