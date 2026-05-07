import mongoose from "mongoose";

const hpodMetricSchema = new mongoose.Schema(
	{
		userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		reportId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "HpodReport",
			required: true,
		},
		gmailMessageId: { type: String, required: true, unique: true },
		reportDate: { type: String, default: null },
		recordedAt: { type: Date, required: true },
		receivedAt: { type: Date, required: true },
		patientName: { type: String, default: null },
		patientEmail: { type: String, default: null },
		patientPhone: { type: String, default: null },
		age: { type: String, default: null },
		gender: { type: String, default: null },
		vitals: {
			weight_kg: { type: Number, default: null },
			height_cm: { type: Number, default: null },
			bmi: { type: Number, default: null },
			bmi_category: { type: String, default: null },
			spo2_percent: { type: Number, default: null },
			body_temperature_f: { type: Number, default: null },
			pulse: { type: Number, default: null },
			blood_pressure: { type: String, default: null },
		},
		bodyComposition: {
			body_fat_mass_kg: { type: Number, default: null },
			body_fat_percent: { type: Number, default: null },
			total_body_water_L: { type: Number, default: null },
			protein_kg: { type: Number, default: null },
			minerals_kg: { type: Number, default: null },
			skeletal_muscle_mass_kg: { type: Number, default: null },
			visceral_fat_cm2: { type: Number, default: null },
			basal_metabolic_rate_cal: { type: Number, default: null },
			intracellular_water_L: { type: Number, default: null },
			extracellular_water_L: { type: Number, default: null },
		},
		ecg: {
			pr_interval: { type: String, default: null },
			qrs_interval: { type: String, default: null },
			qtc_interval: { type: String, default: null },
			heart_rate: { type: String, default: null },
		},
		idealBodyWeight_kg: { type: Number, default: null },
		weightToLose_kg: { type: Number, default: null },
		testsNotTaken: { type: [String], default: [] },
		healthInsight: { type: String, default: "" },
		concerns: { type: [String], default: [] },
		source: { type: String, default: "hpod" },
	},
	{ timestamps: true, collection: "hpod_metrics" },
);

hpodMetricSchema.index({ userId: 1, recordedAt: -1 });
hpodMetricSchema.index({ reportId: 1 });

export default (mongoose.models.HpodMetric as mongoose.Model<any>) ||
	mongoose.model("HpodMetric", hpodMetricSchema);
