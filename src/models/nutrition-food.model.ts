import mongoose from "mongoose";
import { NutritionFoodSource } from "./Enums";

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
		caloriesKcal: { type: Number, required: true },
		proteinG: { type: Number, required: true },
		carbsG: { type: Number, required: true },
		fatG: { type: Number, required: true },
		fiberG: { type: Number, default: null },
		sugarG: { type: Number, default: null },
		micros: { type: Map, of: Number, default: {} },
		barcode: { type: String, default: null },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

nutritionFoodSchema.index({ name: "text", brand: "text" });
nutritionFoodSchema.index({ source: 1, createdBy: 1 });
nutritionFoodSchema.index({ barcode: 1 }, { sparse: true });

export type NutritionFoodDocument = mongoose.InferSchemaType<
	typeof nutritionFoodSchema
>;

const NutritionFood =
	(mongoose.models.NutritionFood as mongoose.Model<NutritionFoodDocument>) ||
	mongoose.model<NutritionFoodDocument>(
		"NutritionFood",
		nutritionFoodSchema,
	);

export default NutritionFood;
