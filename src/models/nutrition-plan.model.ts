import mongoose from "mongoose";
import { NutritionGoal, NutritionPlanStatus } from "./Enums";
import {
	lifestyleRecommendationSchema,
	macroTargetSchema,
	planDaySchema,
} from "./nutrition-shared.schema";

// A user-bound plan. Deep-snapshotted from a template at assign time and
// then INDEPENDENTLY EDITABLE — there is intentionally no propagation from
// the source template. Do not add a "sync from template" feature.
const userNutritionPlanSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		nutritionistId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		sourceTemplateId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "NutritionTemplate",
			default: null,
		},
		name: { type: String, required: true },
		goal: {
			type: String,
			enum: Object.values(NutritionGoal),
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(NutritionPlanStatus),
			default: NutritionPlanStatus.Active,
		},
		startDate: { type: Date, required: true },
		endDate: { type: Date, default: null },
		targetCaloriesKcal: { type: Number, default: null },
		targetMacros: { type: macroTargetSchema, default: () => ({}) },
		durationDays: { type: Number, default: 7 },
		days: { type: [planDaySchema], default: [] },
		lifestyleRecommendations: {
			type: [lifestyleRecommendationSchema],
			default: [],
		},
		hasPdf: { type: Boolean, default: false },
		pdfUrl: { type: String, default: null },
		pdfGeneratedAt: { type: Date, default: null },
		pdfStorageKey: { type: String, default: null },
	},
	{ timestamps: true },
);

userNutritionPlanSchema.index({ userId: 1, status: 1 });
userNutritionPlanSchema.index({ nutritionistId: 1, status: 1 });
userNutritionPlanSchema.index({ userId: 1, startDate: -1 });
userNutritionPlanSchema.index({ sourceTemplateId: 1 });

export type UserNutritionPlanDocument = mongoose.InferSchemaType<
	typeof userNutritionPlanSchema
>;

const UserNutritionPlan =
	(mongoose.models
		.UserNutritionPlan as mongoose.Model<UserNutritionPlanDocument>) ||
	mongoose.model<UserNutritionPlanDocument>(
		"UserNutritionPlan",
		userNutritionPlanSchema,
	);

export default UserNutritionPlan;
