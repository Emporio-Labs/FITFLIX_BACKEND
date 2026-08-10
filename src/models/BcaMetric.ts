import mongoose from "mongoose";

/**
 * Body Composition Analysis (BCA) metric captured by the ActiveX device and
 * pulled via the ActiveX external API (POST /external/bca). One document per
 * scan (deduped by userId + recordedAt).
 */
const bcaMetricSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		recordedAt: { type: Date, required: true },
		receivedAt: { type: Date, required: true },
		patientPhone: { type: String, default: null },
		age: { type: String, default: null },
		gender: { type: String, default: null },
		vitals: {
			weight_kg: { type: Number, default: null },
			height_cm: { type: Number, default: null },
			bmi: { type: Number, default: null },
			pulse: { type: Number, default: null },
			heart_rate: { type: Number, default: null },
		},
		bodyComposition: {
			body_fat_mass_kg: { type: Number, default: null },
			body_fat_percent: { type: Number, default: null },
			skeletal_muscle_mass_kg: { type: Number, default: null },
			muscle_mass_kg: { type: Number, default: null },
			total_body_water_L: { type: Number, default: null },
			protein_kg: { type: Number, default: null },
			minerals_kg: { type: Number, default: null },
			visceral_fat: { type: Number, default: null },
			basal_metabolic_rate_cal: { type: Number, default: null },
			body_age: { type: Number, default: null },
		},
		idealBodyWeight_kg: { type: Number, default: null },
		weightToLose_kg: { type: Number, default: null },
		source: { type: String, default: "activex" },
	},
	{ timestamps: true, collection: "bca_metrics" },
);

// One scan per user per timestamp; sync upserts on this key so re-syncing is idempotent.
bcaMetricSchema.index({ userId: 1, recordedAt: -1 }, { unique: true });

export default (mongoose.models.BcaMetric as mongoose.Model<any>) ||
	mongoose.model("BcaMetric", bcaMetricSchema);
