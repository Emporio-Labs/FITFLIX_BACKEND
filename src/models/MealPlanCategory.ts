import mongoose from "mongoose";

// First-class category entity — one document per category column in the Excel
// "Auto Menu" sheet (Salads, Rice Bowls, Juices, Smoothies, Sandwiches).
// Using categories as a real collection (not string tags) lets recipe-detail
// screens, the Nutrition Hub, and admin management do simple FK queries.

const mealPlanCategorySchema = new mongoose.Schema(
	{
		// Normalised display name, e.g. "Salads"
		name: { type: String, required: true },
		// URL-safe slug, unique, e.g. "salads" (index declared below, not here)
		slug: { type: String, required: true },
		// Verbatim column-header text from the Excel file, e.g. "Non-Veg & Veg Salads"
		headerText: { type: String, required: true },
		// Whether the category contains veg or non-veg options (parsed from header)
		hasVegVariant: { type: Boolean, default: false },
		hasNonVegVariant: { type: Boolean, default: false },
		// Position of this category in the Excel sheet (1-based), used for ordering
		sortOrder: { type: Number, required: true },
		// Column offset in the "Auto Menu" sheet where this category starts (0-based)
		colOffset: { type: Number, required: true },
		// Suggested meal type for recipes in this category (overridden per user plan)
		defaultMealType: { type: String, default: null },
		// Suggested measurement unit for ingredients in this category
		defaultUnit: { type: String, enum: ["g", "ml"], default: "g" },
		description: { type: String, default: "" },
		iconUrl: { type: String, default: null },
	},
	{ timestamps: true },
);

mealPlanCategorySchema.index({ slug: 1 }, { unique: true });
mealPlanCategorySchema.index({ sortOrder: 1 });

export type MealPlanCategoryDocument = mongoose.InferSchemaType<
	typeof mealPlanCategorySchema
>;

const MealPlanCategory =
	(mongoose.models.MealPlanCategory as mongoose.Model<MealPlanCategoryDocument>) ||
	mongoose.model<MealPlanCategoryDocument>(
		"MealPlanCategory",
		mealPlanCategorySchema,
	);

export default MealPlanCategory;
