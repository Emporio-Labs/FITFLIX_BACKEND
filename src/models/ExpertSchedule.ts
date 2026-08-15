import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ExpertType } from "./Enums";

const shiftConfigSchema = new mongoose.Schema(
	{
		startTime: {
			type: String,
			required: true,
		},
		endTime: {
			type: String,
			required: true,
		},
	},
	{ _id: false },
);

const weeklySlotConfigSchema = new mongoose.Schema(
	{
		dayOfWeek: {
			type: Number,
			required: true,
			min: 0, // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
			max: 6,
		},
		startTime: {
			type: String,
			required: false, // "06:00"
		},
		endTime: {
			type: String,
			required: false, // "20:00"
		},
		shifts: {
			type: [shiftConfigSchema],
			default: undefined,
		},
		isAvailable: {
			type: Boolean,
			default: true,
		},
	},
	{ _id: false },
);

const expertScheduleSchema = new mongoose.Schema(
	{
		expertId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			unique: true,
			index: true,
			refPath: "expertModel",
		},
		expertModel: {
			type: String,
			enum: ["Trainer", "User"],
			default: "Trainer",
			required: true,
		},
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			default: ExpertType.Trainer,
			required: true,
			index: true,
		},
		weeklySlots: {
			type: [weeklySlotConfigSchema],
			default: () => [
				{ dayOfWeek: 1, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Mon
				{ dayOfWeek: 2, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Tue
				{ dayOfWeek: 3, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Wed
				{ dayOfWeek: 4, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Thu
				{ dayOfWeek: 5, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Fri
				{ dayOfWeek: 6, startTime: "08:00", endTime: "16:00", isAvailable: true }, // Sat
				{ dayOfWeek: 0, startTime: "08:00", endTime: "14:00", isAvailable: false }, // Sun
			],
		},
		slotDurationMinutes: {
			type: Number,
			default: 45,
			min: 15,
			max: 120,
		},
		bufferMinutes: {
			type: Number,
			default: 15,
			min: 0,
			max: 60,
		},
		blackoutDates: {
			type: [Date],
			default: [],
		},
		maxAdvanceBookingDays: {
			type: Number,
			default: 14,
			min: 1,
			max: 60,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
	},
	{ timestamps: true },
);

applyIdTransform(expertScheduleSchema);

type ExpertScheduleDocument = mongoose.InferSchemaType<
	typeof expertScheduleSchema
>;

export default (mongoose.models
	.ExpertSchedule as mongoose.Model<ExpertScheduleDocument>) ||
	mongoose.model<ExpertScheduleDocument>(
		"ExpertSchedule",
		expertScheduleSchema,
	);
