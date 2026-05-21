import mongoose from "mongoose";

export enum ActivityLevel {
	Sedentary = "Sedentary",
	Light = "Light",
	Moderate = "Moderate",
	Active = "Active",
	VeryActive = "VeryActive",
}

const healthMarkersSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		weight: { type: Number, required: true },
		height: { type: Number, required: true },
		bmi: { type: Number },
		allergies: { type: [String], default: [] },
		medications: { type: [String], default: [] },
		diseaseHistory: { type: [String], default: [] },
		sleepHours: { type: Number, default: undefined },
		activityLevel: {
			type: String,
			enum: Object.values(ActivityLevel),
			default: undefined,
		},
	},
	{ timestamps: true },
);

type HealthMarkersDocument = mongoose.InferSchemaType<
	typeof healthMarkersSchema
>;

export default (mongoose.models.HealthMarkers as mongoose.Model<HealthMarkersDocument>) ||
	mongoose.model<HealthMarkersDocument>("HealthMarkers", healthMarkersSchema);
