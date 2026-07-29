import mongoose from "mongoose";

const dayProgressSchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		scheduledDate: { type: Date, required: true },
		completedAt: { type: Date, default: null },
		sessionId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "WorkoutSession",
			default: null,
		},
		status: {
			type: String,
			enum: ["pending", "completed", "missed"],
			default: "pending",
		},
	},
	{ _id: false },
);

const assignmentExerciseSchema = new mongoose.Schema(
	{
		exerciseId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Exercise",
			required: true,
		},
		orderIndex: { type: Number, required: true },
		section: {
			type: String,
			enum: ["warmup", "workout", "stretching"],
			default: "workout",
		},
		targetSets: { type: Number, required: true },
		targetReps: { type: Number, required: true },
		targetWeightKg: { type: Number, default: 0 },
		restSeconds: { type: Number, default: 60 },
		durationSeconds: { type: Number, default: null },
	},
	{ _id: false },
);

const userDaySchema = new mongoose.Schema(
	{
		dayNumber: { type: Number, required: true },
		name: { type: String, required: true },
		isRestDay: { type: Boolean, default: false },
		exercises: { type: [assignmentExerciseSchema], default: [] },
	},
	{ _id: false },
);

const workoutPlanAssignmentSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		planId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "WorkoutPlan",
			required: true,
		},
		assignedBy: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: "assignedByModel",
			required: true,
		},
		// Whoever assigned this plan can be a trainer or admin (or, via
		// assign-to-me, the member themself) — separate collections, so
		// populate() needs refPath rather than a static ref.
		assignedByModel: {
			type: String,
			enum: ["User", "Trainer", "Admin"],
			default: "User",
		},
		startDate: { type: Date, required: true },
		currentDayIndex: { type: Number, default: 0 },
		status: {
			type: String,
			enum: ["active", "paused", "completed", "abandoned"],
			default: "active",
		},
		isDeleted: { type: Boolean, default: false },
		dayProgress: { type: [dayProgressSchema], default: [] },
		userDays: { type: [userDaySchema], default: [] },
	},
	{ timestamps: true },
);

workoutPlanAssignmentSchema.index({ userId: 1, status: 1 });
workoutPlanAssignmentSchema.index({ planId: 1 });
workoutPlanAssignmentSchema.index({ userId: 1, updatedAt: -1 });
workoutPlanAssignmentSchema.index({
	userId: 1,
	"dayProgress.scheduledDate": 1,
});

export type WorkoutPlanAssignmentDocument = mongoose.InferSchemaType<
	typeof workoutPlanAssignmentSchema
>;

const WorkoutPlanAssignment =
	(mongoose.models
		.WorkoutPlanAssignment as mongoose.Model<WorkoutPlanAssignmentDocument>) ||
	mongoose.model<WorkoutPlanAssignmentDocument>(
		"WorkoutPlanAssignment",
		workoutPlanAssignmentSchema,
	);

export default WorkoutPlanAssignment;
