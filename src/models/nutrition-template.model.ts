import mongoose from "mongoose";
import { NutritionGoal, NutritionPlanStatus } from "./Enums";
import {
	lifestyleRecommendationSchema,
	macroTargetSchema,
	planDaySchema,
} from "./nutrition-shared.schema";

// Reusable, nutritionist-owned blueprint. NOT bound to any user. When
// assigned it is deep-copied into a UserNutritionPlan with no propagation.
const nutritionTemplateSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String, default: "" },
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		goal: {
			type: String,
			enum: Object.values(NutritionGoal),
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(NutritionPlanStatus),
			default: NutritionPlanStatus.Draft,
		},
		tags: { type: [String], default: [] },
		targetCaloriesKcal: { type: Number, default: null },
		targetMacros: { type: macroTargetSchema, default: () => ({}) },
		durationDays: { type: Number, default: 7 },
		days: { type: [planDaySchema], default: [] },
		lifestyleRecommendations: {
			type: [lifestyleRecommendationSchema],
			default: [],
		},
	},
	{ timestamps: true },
);

nutritionTemplateSchema.index({ createdBy: 1, status: 1 });
nutritionTemplateSchema.index({ goal: 1, status: 1 });
nutritionTemplateSchema.index({ tags: 1 });

export type NutritionTemplateDocument = mongoose.InferSchemaType<
	typeof nutritionTemplateSchema
>;

const NutritionTemplate =
	(mongoose.models
		.NutritionTemplate as mongoose.Model<NutritionTemplateDocument>) ||
	mongoose.model<NutritionTemplateDocument>(
		"NutritionTemplate",
		nutritionTemplateSchema,
	);

export default NutritionTemplate;
