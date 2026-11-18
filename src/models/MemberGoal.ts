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
		// IST day (YYYY-MM-DD) `currentValue` belongs to, for daily goals
		// (water, calories, steps). A value from an earlier day reads as 0, so
		// "Daily Longevity Hydration" starts fresh each morning instead of
		// adding up forever. See DAILY_GOAL_TYPES in goal.service.ts.
		progressDate: { type: String, default: null },
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
