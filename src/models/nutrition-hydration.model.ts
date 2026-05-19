import mongoose from "mongoose";

const hydrationEntrySchema = new mongoose.Schema(
	{
		amountMl: { type: Number, required: true },
		at: { type: Date, default: Date.now },
		source: { type: String, default: "Manual" },
	},
	{ _id: false },
);

// One document per user per day (UTC-midnight). Intake is an idempotent
// $inc upsert keyed by the unique {userId,logDate} index.
const nutritionHydrationLogSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		logDate: { type: Date, required: true },
		goalMl: { type: Number, default: 2000 },
		totalMl: { type: Number, default: 0 },
		entries: { type: [hydrationEntrySchema], default: [] },
	},
	{ timestamps: true },
);

nutritionHydrationLogSchema.index(
	{ userId: 1, logDate: 1 },
	{ unique: true },
);

export type NutritionHydrationLogDocument = mongoose.InferSchemaType<
	typeof nutritionHydrationLogSchema
>;

const NutritionHydrationLog =
	(mongoose.models
		.NutritionHydrationLog as mongoose.Model<NutritionHydrationLogDocument>) ||
	mongoose.model<NutritionHydrationLogDocument>(
		"NutritionHydrationLog",
		nutritionHydrationLogSchema,
	);

export default NutritionHydrationLog;
