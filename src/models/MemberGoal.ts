import mongoose from "mongoose";
import { GoalType, GoalStatus } from "./Enums";

const memberGoalSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		type: {
			type: String,
			enum: Object.values(GoalType),
			required: true,
		},
		title: { type: String, required: true, trim: true },
		description: { type: String, default: "" },
		startValue: { type: Number, required: true },
		currentValue: { type: Number, required: true },
		targetValue: { type: Number, required: true },
		unit: { type: String, required: true }, // "kg", "ml", "kcal", "steps", "sessions/week"
		targetDate: { type: Date, default: undefined },
		status: {
			type: String,
			enum: Object.values(GoalStatus),
			default: GoalStatus.Active,
		},
		assignedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
	},
	{ timestamps: true },
);

memberGoalSchema.index({ userId: 1, type: 1, status: 1 });

type MemberGoalDocument = mongoose.InferSchemaType<typeof memberGoalSchema>;

export default (mongoose.models
	.MemberGoal as mongoose.Model<MemberGoalDocument>) ||
	mongoose.model<MemberGoalDocument>("MemberGoal", memberGoalSchema);
