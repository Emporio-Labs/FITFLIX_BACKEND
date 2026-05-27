import mongoose from "mongoose";
import { MealType } from "./Enums";

// Macro target — nullable goals set by the nutritionist on a plan/template.
export const macroTargetSchema = new mongoose.Schema(
	{
		proteinG: { type: Number, default: null },
		carbsG: { type: Number, default: null },
		fatG: { type: Number, default: null },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
	},
	{ _id: false },
);

// Macro totals — computed, defaults to 0 so aggregation never sees null.
export const macroTotalsSchema = new mongoose.Schema(
	{
		caloriesKcal: { type: Number, default: 0 },
		proteinG: { type: Number, default: 0 },
		carbsG: { type: Number, default: 0 },
		fatG: { type: Number, default: 0 },
		fiberG: { type: Number, default: 0 },
		sugarG: { type: Number, default: 0 },
	},
	{ _id: false },
);

// Immutable per-portion macro snapshot. foodId is provenance only —
// editing/deactivating the catalog row must never mutate this.
export const mealFoodItemSchema = new mongoose.Schema(
	{
		foodId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionFood",
			required: true,
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

// One selectable option within a meal. The default option (isDefault=true,
// fallback = first) drives macro math when options are present. Each option
// gets a stable _id so meal logs can reference selectedOptionId /
// completedOptionId instead of array indexes.
export const mealOptionSchema = new mongoose.Schema({
	title: { type: String, required: true },
	isDefault: { type: Boolean, default: false },
	foods: { type: [mealFoodItemSchema], default: [] },
	macros: { type: macroTotalsSchema, default: () => ({}) },
	reasoning: { type: String, default: "" },
});

// Lifestyle recommendation attached at the plan/template level.
export const lifestyleRecommendationSchema = new mongoose.Schema(
	{
		title: { type: String, required: true },
		description: { type: String, default: "" },
		category: { type: String, default: "" },
	},
	{ _id: false },
);

export const templateMealSchema = new mongoose.Schema(
	{
		mealType: {
			type: String,
			enum: Object.values(MealType),
			required: true,
		},
		name: { type: String, required: true },
		timeOfDay: { type: String, default: null },
		notes: { type: String, default: "" },
		items: { type: [mealFoodItemSchema], default: [] },
		// Optional multi-option support. When present the default option's
		// foods drive planned-macro math; items[] stays for backward compat.
		options: { type: [mealOptionSchema], default: [] },
	},
	{ _id: false },
);

// Shared by NutritionTemplate.days and UserNutritionPlan.days — the plan
// is a deep snapshot of the template, so the shapes are identical.
export const planDaySchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		meals: { type: [templateMealSchema], default: [] },
	},
	{ _id: false },
);
