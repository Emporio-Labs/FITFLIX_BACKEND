import mongoose from "mongoose";

export enum WorkoutExperience {
	None = "None",
	Beginner = "Beginner",
	Intermediate = "Intermediate",
	Advanced = "Advanced",
}

const healthGoalsSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		goals: { type: [String], required: true },
		targetWeight: { type: Number, default: undefined },
		timeline: { type: String, default: undefined },
		workoutExperience: {
			type: String,
			enum: Object.values(WorkoutExperience),
			default: undefined,
		},
		foodPreferences: { type: [String], default: [] },
	},
	{ timestamps: true },
);

type HealthGoalsDocument = mongoose.InferSchemaType<typeof healthGoalsSchema>;

export default (mongoose.models.HealthGoals as mongoose.Model<HealthGoalsDocument>) ||
	mongoose.model<HealthGoalsDocument>("HealthGoals", healthGoalsSchema);
