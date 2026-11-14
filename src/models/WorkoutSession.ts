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
		rpe: { type: Number, min: 1, max: 10, default: null },
		reflection: { type: String, default: null },
		coachReaction: {
			type: new mongoose.Schema(
				{
					coachId: {
						type: mongoose.Schema.Types.ObjectId,
						refPath: "coachReaction.coachModel",
						default: null,
					},
					coachModel: {
						type: String,
						enum: ["Trainer", "Admin"],
						default: "Trainer",
					},
					coachName: { type: String, default: null },
					reaction: { type: String, default: null },
					comment: { type: String, default: null },
					reactedAt: { type: Date, default: null },
				},
				{ _id: false },
			),
			default: null,
		},
		planId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "WorkoutPlan",
			default: null,
		},
		isDeleted: { type: Boolean, default: false, index: true },
		// Bumped alongside `updatedAt` on every mutation to this session or
		// its exercises/sets, so a trainer's phone and the member's app can
		// each poll and detect "the other side changed something".
		lastTouchedBy: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: "lastTouchedByModel",
			default: null,
		},
		lastTouchedByModel: {
			type: String,
			enum: ["User", "Trainer", "Admin"],
			default: "User",
		},
		isOverseen: { type: Boolean, default: false },
		lastOverseenAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

workoutSessionSchema.index({ userId: 1, date: -1 });
workoutSessionSchema.index({ userId: 1, status: 1 });
workoutSessionSchema.index({ userId: 1, completedAt: -1 });
workoutSessionSchema.index({ userId: 1, date: -1, status: 1 });
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
