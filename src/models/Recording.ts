import mongoose from "mongoose";

/**
 * Recording Model — FX-23
 *
 * Cloud recording records for live streams and group sessions.
 * Tracked from the moment host goes live until stream ends.
 * Supports member replay listing, entitlement verification, admin visibility toggling,
 * and signed time-limited playback links.
 */
const recordingSchema = new mongoose.Schema(
	{
		sessionId: {
			type: String,
			ref: "ScheduledSession",
			required: true,
			index: true,
		},
		classId: {
			type: String,
			ref: "Class",
			required: true,
			index: true,
		},
		sessionType: {
			type: String,
			enum: ["live_stream"],
			default: "live_stream",
			index: true,
		},
		title: {
			type: String,
			required: true,
			trim: true,
		},
		instructorName: {
			type: String,
			default: "Staff",
			trim: true,
		},
		instructorUserId: {
			type: String,
			ref: "User",
			default: null,
		},
		branchId: {
			type: String,
			ref: "Location",
			default: null,
			index: true,
		},
		videoRoomId: {
			type: String,
			required: true,
			trim: true,
		},
		recordingTaskId: {
			type: String,
			default: null,
			trim: true,
		},
		startedAt: {
			type: Date,
			required: true,
		},
		endedAt: {
			type: Date,
			default: null,
		},
		durationSeconds: {
			type: Number,
			default: 0,
			min: 0,
		},
		fileUrl: {
			type: String,
			default: null,
			trim: true,
		},
		thumbnailUrl: {
			type: String,
			default: null,
			trim: true,
		},
		status: {
			type: String,
			enum: ["RECORDING", "PROCESSING", "READY", "FAILED"],
			default: "RECORDING",
			required: true,
			index: true,
		},
		isHidden: {
			type: Boolean,
			default: false,
			index: true,
		},
		isDeleted: {
			type: Boolean,
			default: false,
			index: true,
		},
		accessSnapshot: {
			access: { type: String, default: "" },
			bookingRequirement: { type: String, default: "" },
		},
		viewsCount: {
			type: Number,
			default: 0,
			min: 0,
		},
	},
	{
		timestamps: true,
	},
);

recordingSchema.index({ status: 1, isHidden: 1, isDeleted: 1, createdAt: -1 });
recordingSchema.index({ sessionId: 1, status: 1 });

export type RecordingDocument = mongoose.InferSchemaType<typeof recordingSchema>;

export default (mongoose.models.Recording as mongoose.Model<RecordingDocument>) ||
	mongoose.model<RecordingDocument>("Recording", recordingSchema);
