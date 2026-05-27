import mongoose from "mongoose";
import { DietaryPreference, NutritionGoal } from "./Enums";
import { macroTargetSchema } from "./nutrition-shared.schema";

// Clinical nutrition profile created by a nutritionist for a user.
// Pre-populated from onboarding HealthMarkers/HealthGoals at creation time
// but independently editable — the nutritionist's clinical assessment may
// intentionally differ from the user's self-reported onboarding data.
const nutritionProfileSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		dietaryPreference: {
			type: String,
			enum: Object.values(DietaryPreference),
			default: DietaryPreference.NonVeg,
		},
		allergies: { type: [String], default: [] },
		medicalConditions: { type: [String], default: [] },
		preferredFoods: { type: [String], default: [] },
		dislikedFoods: { type: [String], default: [] },
		goal: {
			type: String,
			enum: Object.values(NutritionGoal),
			required: true,
		},
		targetCaloriesKcal: { type: Number, default: null },
		targetMacros: { type: macroTargetSchema, default: () => ({}) },
		mealsPerDay: { type: Number, default: 3 },
		// Stored in ml for consistency with hydration model. API layer
		// accepts/exposes waterTargetLiters and converts.
		waterTargetMl: { type: Number, default: null },
		notes: { type: String, default: "" },
		createdByNutritionist: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
	},
	{ timestamps: true },
);

// userId index is created implicitly by `unique: true` on the field above.
nutritionProfileSchema.index({ createdByNutritionist: 1 });
nutritionProfileSchema.index({ createdByNutritionist: 1, updatedAt: -1 });
nutritionProfileSchema.index({ goal: 1 });

export type NutritionProfileDocument = mongoose.InferSchemaType<
	typeof nutritionProfileSchema
>;

const NutritionProfile =
	(mongoose.models
		.NutritionProfile as mongoose.Model<NutritionProfileDocument>) ||
	mongoose.model<NutritionProfileDocument>(
		"NutritionProfile",
		nutritionProfileSchema,
	);

export default NutritionProfile;
