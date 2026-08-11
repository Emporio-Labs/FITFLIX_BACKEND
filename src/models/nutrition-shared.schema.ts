import mongoose from "mongoose";
import { IngredientUnit, MealType } from "./Enums";

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
// unit preserves the original Excel measure ("g" or "ml"); quantityG stores
// the numeric value verbatim — for ml items density≈1 is assumed for
// display purposes only, never for macro math.
export const mealFoodItemSchema = new mongoose.Schema(
	{
		foodId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionFood",
			required: true,
		},
		foodName: { type: String, required: true },
		quantityG: { type: Number, required: true },
		unit: {
			type: String,
			enum: Object.values(IngredientUnit),
			default: IngredientUnit.Gram,
		},
		caloriesKcal: { type: Number, required: true },
		proteinG: { type: Number, required: true },
		carbsG: { type: Number, required: true },
		fatG: { type: Number, required: true },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
		recipeSource: { type: String, default: null },
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
	cookingDirections: { type: [String], default: [] },
	prepTimeMinutes: { type: Number, default: null },
	recipeId: {
		type: String,
		default: null,
	},
	recipeName: { type: String, default: null },
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
		// Optional back-reference to the canonical Recipe document. Set when the
		// template meal was seeded from a Recipe; null for manually-authored meals.
		recipeId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Recipe",
			default: null,
		},
		timeOfDay: { type: String, default: null },
		notes: { type: String, default: "" },
		items: { type: [mealFoodItemSchema], default: [] },
		// Optional multi-option support. When present the default option's
		// foods drive planned-macro math; items[] stays for backward compat.
		options: { type: [mealOptionSchema], default: [] },
		cookingDirections: { type: [String], default: [] },
		prepTimeMinutes: { type: Number, default: null },
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

// A household portion for a NutritionFood ("1 roti", "1 cup", "1 medium
// banana"). gramsPerUnit converts the label to grams so all macro math still
// flows through scaleMacros() — this is a display/input layer only, never a
// second macro engine.
export const servingSchema = new mongoose.Schema(
	{
		label: { type: String, required: true },
		gramsPerUnit: { type: Number, required: true },
		isDefault: { type: Boolean, default: false },
	},
	{ _id: false },
);
