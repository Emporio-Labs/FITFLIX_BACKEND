import mongoose from "mongoose";

const setLogSchema = new mongoose.Schema(
	{
		workoutExerciseId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "WorkoutExercise",
			required: true,
		},
		setNumber: { type: Number, required: true },
		actualReps: { type: Number, required: true },
		actualWeightKg: { type: Number, required: true },
		rpe: { type: Number, min: 1, max: 10, default: null },
		isWarmup: { type: Boolean, default: false },
		completedAt: { type: Date, default: Date.now },
		notes: { type: String, default: null },
	},
	{ timestamps: true },
);

setLogSchema.index({ workoutExerciseId: 1, setNumber: 1 });

export type SetLogDocument = mongoose.InferSchemaType<typeof setLogSchema>;

const SetLog =
	(mongoose.models.SetLog as mongoose.Model<SetLogDocument>) ||
	mongoose.model<SetLogDocument>("SetLog", setLogSchema);

export default SetLog;
