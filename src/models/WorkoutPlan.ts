import mongoose from "mongoose";
import {
	ExerciseDifficulty,
	ExerciseSection,
	PlanGoal,
	PlanStatus,
	SplitType,
} from "./Enums";

const planExerciseSchema = new mongoose.Schema(
	{
		exerciseId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Exercise",
			required: true,
		},
		orderIndex: { type: Number, required: true },
		targetSets: { type: Number, required: true },
		targetReps: { type: Number, required: true },
		targetWeightKg: { type: Number, default: 0 },
		restSeconds: { type: Number, default: 60 },
		section: {
			type: String,
			enum: Object.values(ExerciseSection),
			default: ExerciseSection.Workout,
		},
		durationSeconds: { type: Number, default: null },
		notes: { type: String, default: null },
	},
	{ _id: false },
);

const planDaySchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		name: { type: String, required: true },
		isRestDay: { type: Boolean, default: false },
		exercises: { type: [planExerciseSchema], default: [] },
	},
	{ _id: false },
);

const workoutPlanSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String, default: "" },
		difficulty: {
			type: String,
			enum: Object.values(ExerciseDifficulty),
			required: true,
		},
		duration: { type: Number, required: true },
		goal: {
			type: String,
			enum: Object.values(PlanGoal),
			required: true,
		},
		splitType: {
			type: String,
			enum: Object.values(SplitType),
			default: SplitType.Custom,
		},
		status: {
			type: String,
			enum: Object.values(PlanStatus),
			default: PlanStatus.Draft,
		},
		isTemplate: { type: Boolean, default: false },
		templateCategory: { type: String, default: null },
		createdBy: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: "createdByModel",
			required: true,
		},
		// A plan's author can be a member, a trainer, or an admin — these live
		// in separate collections, so a static `ref` can't resolve populate().
		createdByModel: {
			type: String,
			enum: ["User", "Trainer", "Admin"],
			default: "User",
		},
		assignedUsers: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "User",
				default: [],
			},
		],
		days: { type: [planDaySchema], default: [] },
	},
	{ timestamps: true },
);

workoutPlanSchema.index({ createdBy: 1 });
workoutPlanSchema.index({ status: 1 });
workoutPlanSchema.index({ assignedUsers: 1 });

export type WorkoutPlanDocument = mongoose.InferSchemaType<
	typeof workoutPlanSchema
>;

const WorkoutPlan =
	(mongoose.models.WorkoutPlan as mongoose.Model<WorkoutPlanDocument>) ||
	mongoose.model<WorkoutPlanDocument>("WorkoutPlan", workoutPlanSchema);

export default WorkoutPlan;
