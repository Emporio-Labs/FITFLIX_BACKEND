import mongoose from "mongoose";
import { WaitlistStatus } from "./Enums";

const classWaitlistSchema = new mongoose.Schema(
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
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		status: {
			type: String,
			enum: Object.values(WaitlistStatus),
			default: WaitlistStatus.Waiting,
			required: true,
			index: true,
		},
		joinedAt: {
			type: Date,
			default: () => new Date(),
			required: true,
		},
		promotedAt: {
			type: Date,
			default: null,
		},
		promotedBookingId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Booking",
			default: null,
		},
		skippedAt: {
			type: Date,
			default: null,
		},
		skipReason: {
			type: String,
			default: null,
		},
		leftAt: {
			type: Date,
			default: null,
		},
	},
	{ timestamps: true },
);

// FIFO queue scan & 1-based position counting per session
classWaitlistSchema.index({ sessionId: 1, status: 1, joinedAt: 1, _id: 1 });
// Admin class-level waitlist filtering
classWaitlistSchema.index({ classId: 1, status: 1, joinedAt: 1 });
// Prevent duplicate active WAITING entries for the same user + session
classWaitlistSchema.index(
	{ sessionId: 1, user: 1 },
	{
		unique: true,
		partialFilterExpression: { status: WaitlistStatus.Waiting },
	},
);

export type ClassWaitlistDocument = mongoose.InferSchemaType<
	typeof classWaitlistSchema
>;

export default (mongoose.models
	.ClassWaitlist as mongoose.Model<ClassWaitlistDocument>) ||
	mongoose.model<ClassWaitlistDocument>("ClassWaitlist", classWaitlistSchema);
