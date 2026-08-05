import mongoose from "mongoose";

const scheduledSessionSchema = new mongoose.Schema(
	{
		classId: {
			type: String,
			ref: "Class",
			required: true,
		},
		trainerId: {
			type: String,
			ref: "Trainer",
			default: null,
		},
		sessionDate: {
			type: Date,
			required: true,
		},
		startTime: {
			type: String,
			required: true,
		},
		endTime: {
			type: String,
			required: true,
		},
		deliveryType: {
			type: String,
			enum: ["ONLINE", "OFFLINE", "HYBRID"],
			default: "OFFLINE",
			required: true,
		},
		locationAddress: {
			type: String,
			default: null,
		},
		capacity: {
			type: Number,
			default: 20,
			min: 1,
			required: true,
		},
		currentBookings: {
			type: Number,
			default: 0,
			min: 0,
			required: true,
		},
		remainingCapacity: {
			type: Number,
			default: 20,
			min: 0,
			required: true,
		},
		status: {
			type: String,
			enum: ["SCHEDULED", "FULL", "CANCELLED", "COMPLETED"],
			default: "SCHEDULED",
			required: true,
		},
		recurrenceRule: {
			type: String,
			enum: ["NONE", "DAILY", "WEEKLY"],
			default: "NONE",
			required: true,
		},
		streamRoomId: {
			type: String,
			default: null,
		},
		videoRoomId: {
			type: String,
			default: null,
		},
		isPublished: {
			type: Boolean,
			default: true,
			required: true,
		},
	},
	{ timestamps: true },
);

type ScheduledSessionDocument = mongoose.InferSchemaType<
	typeof scheduledSessionSchema
>;

export default (mongoose.models.ScheduledSession as mongoose.Model<ScheduledSessionDocument>) ||
	mongoose.model<ScheduledSessionDocument>(
		"ScheduledSession",
		scheduledSessionSchema,
	);
