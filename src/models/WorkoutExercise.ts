import mongoose from "mongoose";

const workoutExerciseSchema = new mongoose.Schema(
	{
		sessionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "WorkoutSession",
			required: true,
		},
		exerciseId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Exercise",
			required: true,
		},
		orderIndex: { type: Number, required: true },
		targetSets: { type: Number, required: true },
		targetReps: { type: Number, required: true },
		targetWeightKg: { type: Number, default: null },
		restSeconds: { type: Number, default: 60 },
		isCompleted: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

workoutExerciseSchema.index({ sessionId: 1, orderIndex: 1 });

export type WorkoutExerciseDocument = mongoose.InferSchemaType<
	typeof workoutExerciseSchema
>;

const WorkoutExercise =
	(mongoose.models.WorkoutExercise as mongoose.Model<WorkoutExerciseDocument>) ||
	mongoose.model<WorkoutExerciseDocument>(
		"WorkoutExercise",
		workoutExerciseSchema,
	);

export default WorkoutExercise;
