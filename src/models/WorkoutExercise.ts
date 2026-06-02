import mongoose from "mongoose";
import { ExerciseSection } from "./Enums";

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
		// Workout section this exercise was placed in. Defaults to "workout"
		// so pre-existing rows stay in the main workout section.
		section: {
			type: String,
			enum: Object.values(ExerciseSection),
			default: ExerciseSection.Workout,
		},
		targetSets: { type: Number, required: true },
		targetReps: { type: Number, required: true },
		targetWeightKg: { type: Number, default: null },
		restSeconds: { type: Number, default: 60 },
		// Time-based entries (e.g. Plank, stretches).
		durationSeconds: { type: Number, default: null },
		notes: { type: String, default: null },
		caloriesBurned: { type: Number, default: null },
		isCompleted: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

workoutExerciseSchema.index({ sessionId: 1, orderIndex: 1 });

export type WorkoutExerciseDocument = mongoose.InferSchemaType<
	typeof workoutExerciseSchema
>;

const WorkoutExercise =
	(mongoose.models
		.WorkoutExercise as mongoose.Model<WorkoutExerciseDocument>) ||
	mongoose.model<WorkoutExerciseDocument>(
		"WorkoutExercise",
		workoutExerciseSchema,
	);

export default WorkoutExercise;
