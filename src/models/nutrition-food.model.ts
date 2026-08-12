import mongoose from "mongoose";
import { NutritionFoodSource } from "./Enums";
import { servingSchema } from "./nutrition-shared.schema";

// Canonical macros are stored per `basePer` grams (default 100g). Any
// portion is derived deterministically: scaled = base * quantityG / basePer.
const nutritionFoodSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		brand: { type: String, default: null },
		source: {
			type: String,
			enum: Object.values(NutritionFoodSource),
			default: NutritionFoodSource.System,
		},
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		basePer: { type: Number, default: 100 },
		servingLabel: { type: String, default: "100 g" },
		servings: { type: [servingSchema], default: [] },
		caloriesKcal: { type: Number, required: true },
		proteinG: { type: Number, required: true },
		carbsG: { type: Number, required: true },
		fatG: { type: Number, required: true },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
		micros: { type: Map, of: Number, default: {} },
		barcode: { type: String, default: null },
		isActive: { type: Boolean, default: true },
		isVeg: { type: Boolean, default: undefined },
		allergens: { type: [String], default: [] },
		mealTypes: { type: [String], default: [] },
		tags: { type: [String], default: [] },
		// Provenance for foods cached in from an external database (e.g.
		// Open Food Facts) the first time a member logs them. Null for
		// System/Custom foods.
		externalSource: { type: String, default: null },
		externalId: { type: String, default: null },
		imageUrl: { type: String, default: null },
	},
	{ timestamps: true },
);

nutritionFoodSchema.index({ name: "text", brand: "text" });
nutritionFoodSchema.index({ source: 1, createdBy: 1 });
nutritionFoodSchema.index({ barcode: 1 }, { sparse: true });
nutritionFoodSchema.index({ isVeg: 1, isActive: 1 });
nutritionFoodSchema.index({ allergens: 1 });
nutritionFoodSchema.index({ mealTypes: 1 });
nutritionFoodSchema.index({ tags: 1 });
// Idempotency key for cache-on-log: ensureExternalFoodPersisted upserts on
// this pair so the same OFF product never gets duplicated into the catalog.
nutritionFoodSchema.index(
	{ externalSource: 1, externalId: 1 },
	{ unique: true, sparse: true },
);

export type NutritionFoodDocument = mongoose.InferSchemaType<
	typeof nutritionFoodSchema
>;

const NutritionFood =
	(mongoose.models.NutritionFood as mongoose.Model<NutritionFoodDocument>) ||
	mongoose.model<NutritionFoodDocument>("NutritionFood", nutritionFoodSchema);

export default NutritionFood;
