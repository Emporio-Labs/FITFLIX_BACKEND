import mongoose from "mongoose";
import { MealType, NutritionFoodSource } from "./Enums";

// Canonical recipe — one document per unique recipe in the Excel "Auto Menu"
// sheet.  This is the source of truth for recipe identity; it is NOT bound to
// any nutritionist template or user plan.  When a nutritionist builds a
// NutritionTemplate, each templateMealSchema.recipeId points here.

const recipeTotalsSchema = new mongoose.Schema(
	{
		caloriesKcal: { type: Number, default: 0 },
		proteinG: { type: Number, default: 0 },
		carbsG: { type: Number, default: 0 },
		fatG: { type: Number, default: 0 },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
	},
	{ _id: false },
);

const recipeSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		slug: { type: String, required: true },
		categoryId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "MealPlanCategory",
			required: true,
		},
		// true = vegetarian, false = non-vegetarian, null = unknown/mixed
		isVeg: { type: Boolean, default: null },
		// Suggested meal time for this recipe (set from category default, can be
		// overridden when a nutritionist assigns it to a user plan)
		defaultMealType: {
			type: String,
			enum: Object.values(MealType),
			default: null,
		},
		// Denormalized sum of RecipeIngredient rows — kept in sync at import time
		// and whenever ingredients change.  Re-derivable via aggregation.
		totals: { type: recipeTotalsSchema, default: () => ({}) },
		// "System" for Excel-seeded records; "Custom" for nutritionist-authored
		source: {
			type: String,
			enum: Object.values(NutritionFoodSource),
			default: NutritionFoodSource.System,
		},
		// SHA-256 prefix of the source Excel file, groups all docs from one import
		importBatchId: { type: String, default: null },
		// Admin or nutritionist who triggered the import (optional for system seed)
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		isActive: { type: Boolean, default: true },
		description: { type: String, default: "" },
		prepTimeMinutes: { type: Number, default: null },
		cookingDirections: { type: [String], default: [] },
		imageUrl: { type: String, default: null },
		tags: { type: [String], default: [] },
	},
	{ timestamps: true },
);

recipeSchema.index({ slug: 1, categoryId: 1 }, { unique: true });
recipeSchema.index({ categoryId: 1, isActive: 1 });
recipeSchema.index({ isVeg: 1, isActive: 1 });
recipeSchema.index({ source: 1 });
recipeSchema.index({ importBatchId: 1 });
recipeSchema.index({ name: "text" });

export type RecipeDocument = mongoose.InferSchemaType<typeof recipeSchema>;

const Recipe =
	(mongoose.models.Recipe as mongoose.Model<RecipeDocument>) ||
	mongoose.model<RecipeDocument>("Recipe", recipeSchema);

export default Recipe;
