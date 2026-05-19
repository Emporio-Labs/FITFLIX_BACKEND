import mongoose from "mongoose";
import { ProgressRecordedBy } from "./Enums";

const measurementsSchema = new mongoose.Schema(
	{
		chestCm: { type: Number, default: null },
		waistCm: { type: Number, default: null },
		hipCm: { type: Number, default: null },
		armCm: { type: Number, default: null },
		thighCm: { type: Number, default: null },
	},
	{ _id: false },
);

// Append-only progress time-series. Distinct from HealthMarkers (a single
// onboarding snapshot) — this keeps history and is plan-scoped.
const nutritionProgressSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		planId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "UserNutritionPlan",
			default: null,
		},
		recordedAt: { type: Date, required: true },
		weightKg: { type: Number, default: null },
		bodyFatPct: { type: Number, default: null },
		measurements: { type: measurementsSchema, default: () => ({}) },
		photoUrls: { type: [String], default: [] },
		note: { type: String, default: "" },
		recordedBy: {
			type: String,
			enum: Object.values(ProgressRecordedBy),
			default: ProgressRecordedBy.User,
		},
	},
	{ timestamps: true },
);

nutritionProgressSchema.index({ userId: 1, recordedAt: -1 });
nutritionProgressSchema.index({ planId: 1, recordedAt: -1 });

export type NutritionProgressDocument = mongoose.InferSchemaType<
	typeof nutritionProgressSchema
>;

const NutritionProgress =
	(mongoose.models
		.NutritionProgress as mongoose.Model<NutritionProgressDocument>) ||
	mongoose.model<NutritionProgressDocument>(
		"NutritionProgress",
		nutritionProgressSchema,
	);

export default NutritionProgress;
