import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const classSchema = new mongoose.Schema(
	{
		_id: {
			type: String,
			default: () => randomUUID(),
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		description: {
			type: String,
			default: "",
			trim: true,
		},
		mode: {
			type: String,
			enum: ["online", "offline", "hybrid"],
			default: "offline",
		},
		sessionType: {
			type: String,
			enum: ["group_class", "live_stream", ""],
			default: "",
		},
		instructor: {
			type: String,
			default: "Staff",
			trim: true,
		},
		// User account that hosts this class — determines host vs audience role
		// in ZEGOCLOUD live streaming (GCLS-24). Distinct from the `instructor`
		// display-name string which remains for backwards compatibility.
		instructorUserId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		durationMinutes: {
			type: Number,
			default: 60,
			min: 1,
		},
		maxParticipants: {
			type: Number,
			default: 20,
			min: 1,
		},
		tags: {
			type: [String],
			default: [],
		},
		scheduleInfo: {
			type: String,
			default: "",
		},
		recurrenceRule: {
			type: String,
			enum: ["NONE", "DAILY", "WEEKLY", "MONTHLY"],
			default: "NONE",
		},
		schedulePattern: {
			type: String,
			default: null,
		},
		scheduleType: {
			type: String,
			default: "Fixed Session",
		},
		daysOfWeek: {
			type: [Number],
			default: [],
		},
		locationAddress: {
			type: String,
			default: "",
		},
		streamRoomId: {
			type: String,
			default: "",
		},
		enableWaitlist: {
			type: Boolean,
			default: false,
		},
		status: {
			type: String,
			enum: ["ACTIVE", "INACTIVE"],
			default: "ACTIVE",
			required: true,
			index: true,
		},
		creditCost: {
			type: Number,
			required: true,
			min: 1,
		},
		bookingWindowValue: {
			type: Number,
			default: 72,
			min: 1,
		},
		bookingWindowUnit: {
			type: String,
			enum: ["hours", "days"],
			default: "hours",
		},
		bookingCloseValue: {
			type: Number,
			default: null,
			min: 0,
		},
		bookingCloseUnit: {
			type: String,
			enum: ["minutes", "hours", "days"],
			default: null,
		},
		isPublished: {
			type: Boolean,
			default: true,
		},
	},
	{
		timestamps: true,
	},
);

type ClassDocument = mongoose.InferSchemaType<typeof classSchema>;

export default (mongoose.models.Class as mongoose.Model<ClassDocument>) ||
	mongoose.model<ClassDocument>("Class", classSchema);
