import mongoose from "mongoose";
import { HabitCategory, HabitFrequency } from "./Enums";

const habitSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		title: { type: String, required: true, trim: true },
		description: { type: String, default: "" },
		category: {
			type: String,
			enum: Object.values(HabitCategory),
			default: HabitCategory.Custom,
		},
		icon: { type: String, required: true, default: "check_circle" },
		isDefault: { type: Boolean, default: false },
		isPinnedToHome: { type: Boolean, default: false },
		pinnedOrder: { type: Number, default: 0 },
		frequency: {
			type: String,
			enum: Object.values(HabitFrequency),
			default: HabitFrequency.Daily,
		},
		targetDaysPerWeek: { type: Number, default: 7 },
		currentStreak: { type: Number, default: 0 },
		longestStreak: { type: Number, default: 0 },
		totalCompletions: { type: Number, default: 0 },
		isActive: { type: Boolean, default: true },
		assignedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		timeOfDayHint: {
			type: String,
			enum: ["MORNING", "ANYTIME", "EVENING"],
			default: "ANYTIME",
		},
	},
	{ timestamps: true },
);

habitSchema.index({ userId: 1, isActive: 1, isPinnedToHome: 1 });

type HabitDocument = mongoose.InferSchemaType<typeof habitSchema>;

export default (mongoose.models.Habit as mongoose.Model<HabitDocument>) ||
	mongoose.model<HabitDocument>("Habit", habitSchema);
