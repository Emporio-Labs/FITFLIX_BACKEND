import mongoose from "mongoose";
import { ReminderKind, ReminderStatus } from "./Enums";

const scheduledReminderSchema = new mongoose.Schema(
	{
		appointmentId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			required: true,
		},
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// UTC time at which this reminder should fire
		fireAt: { type: Date, required: true },
		kind: {
			type: String,
			enum: Object.values(ReminderKind),
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(ReminderStatus),
			default: ReminderStatus.Scheduled,
		},
		attempts: { type: Number, default: 0 },
		lastError: { type: String, default: undefined },
	},
	{ timestamps: true },
);

// Poller queries: status=SCHEDULED & fireAt <= now
scheduledReminderSchema.index({ status: 1, fireAt: 1 });
scheduledReminderSchema.index({ appointmentId: 1, kind: 1 }, { unique: true });

type ScheduledReminderDocument = mongoose.InferSchemaType<
	typeof scheduledReminderSchema
>;

export default (mongoose.models
	.ScheduledReminder as mongoose.Model<ScheduledReminderDocument>) ||
	mongoose.model<ScheduledReminderDocument>(
		"ScheduledReminder",
		scheduledReminderSchema,
	);
