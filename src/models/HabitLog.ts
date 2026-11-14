import mongoose from "mongoose";
import { HabitLogSource } from "./Enums";

const habitLogSchema = new mongoose.Schema(
	{
		habitId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Habit",
			required: true,
			index: true,
		},
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		date: { type: String, required: true }, // "YYYY-MM-DD" IST
		completed: { type: Boolean, required: true, default: true },
		completedAt: { type: Date, default: Date.now },
		source: {
			type: String,
			enum: Object.values(HabitLogSource),
			default: HabitLogSource.Manual,
		},
		note: { type: String, default: undefined },
	},
	{ timestamps: true },
);

habitLogSchema.index({ habitId: 1, date: 1 }, { unique: true });
habitLogSchema.index({ userId: 1, date: 1 });

type HabitLogDocument = mongoose.InferSchemaType<typeof habitLogSchema>;

export default (mongoose.models.HabitLog as mongoose.Model<HabitLogDocument>) ||
	mongoose.model<HabitLogDocument>("HabitLog", habitLogSchema);
