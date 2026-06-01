import mongoose from "mongoose";
import { IngredientUnit } from "./Enums";

// One document per ingredient line in the Excel "Auto Menu" sheet.
// This is the join between Recipe ←→ NutritionFood with all per-portion
// values stored verbatim from the Excel cells.
//
// foodId is nullable: for ingredients not resolved against the NutritionFood
// catalog (no Sheet2 entry and no derivable match), foodId is null and the
// rawIngredientName is the only reference.  These can be resolved manually
// later without re-running the full import.

const recipeIngredientSchema = new mongoose.Schema(
	{
		recipeId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Recipe",
			required: true,
		},
		// Resolved FK into the NutritionFood catalog; null if unresolved
		foodId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionFood",
			default: null,
		},
		// Verbatim ingredient name from the Excel cell, e.g. "Chicken"
		rawIngredientName: { type: String, required: true },
		// Verbatim quantity string from the Excel cell, e.g. "120", "60g(2 slices)", "2 eggs"
		rawQuantityStr: { type: String, default: null },
		// Extracted numeric quantity (null if non-parseable, e.g. "Negligible calories")
		quantity: { type: Number, default: null },
		// Measurement unit preserved exactly from the Excel context
		unit: {
			type: String,
			enum: Object.values(IngredientUnit),
			default: IngredientUnit.Gram,
		},
		// Macro values verbatim from Excel — null when the cell was empty
		caloriesKcal: { type: Number, default: null },
		proteinG: { type: Number, default: null },
		carbsG: { type: Number, default: null },
		fatG: { type: Number, default: null },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
		// Position of this ingredient within its recipe (0-based, preserves row order)
		sortOrder: { type: Number, required: true },
		// Provenance: physical Excel row that produced this record
		sourceRowId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "MealPlanImportRow",
			default: null,
		},
	},
	{ timestamps: true },
);

recipeIngredientSchema.index({ recipeId: 1, sortOrder: 1 }, { unique: true });
recipeIngredientSchema.index({ foodId: 1 });
recipeIngredientSchema.index({ recipeId: 1 });

export type RecipeIngredientDocument = mongoose.InferSchemaType<
	typeof recipeIngredientSchema
>;

const RecipeIngredient =
	(mongoose.models.RecipeIngredient as mongoose.Model<RecipeIngredientDocument>) ||
	mongoose.model<RecipeIngredientDocument>(
		"RecipeIngredient",
		recipeIngredientSchema,
	);

export default RecipeIngredient;
