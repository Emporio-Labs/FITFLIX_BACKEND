import mongoose from "mongoose";
import { WorkoutSessionStatus } from "./Enums";

const workoutSessionSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		date: { type: Date, required: true },
		status: {
			type: String,
			enum: Object.values(WorkoutSessionStatus),
			default: WorkoutSessionStatus.Active,
		},
		startedAt: { type: Date, default: Date.now },
		completedAt: { type: Date, default: null },
		notes: { type: String, default: null },
	},
	{ timestamps: true },
);

workoutSessionSchema.index({ userId: 1, date: -1 });
workoutSessionSchema.index({ userId: 1, status: 1 });
workoutSessionSchema.index(
	{ userId: 1, date: 1 },
	{
		unique: true,
		partialFilterExpression: { status: WorkoutSessionStatus.Active },
	},
);

export type WorkoutSessionDocument = mongoose.InferSchemaType<
	typeof workoutSessionSchema
>;

const WorkoutSession =
	(mongoose.models.WorkoutSession as mongoose.Model<WorkoutSessionDocument>) ||
	mongoose.model<WorkoutSessionDocument>(
		"WorkoutSession",
		workoutSessionSchema,
	);

export default WorkoutSession;
