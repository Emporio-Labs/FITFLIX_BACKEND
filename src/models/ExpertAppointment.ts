import mongoose from "mongoose";
import {
	AppointmentBookingStatus,
	AppointmentMode,
	AppointmentSource,
	ExpertType,
	WebhookSyncStatus,
} from "./Enums";

const expertAppointmentSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			required: true,
		},
		bookingStatus: {
			type: String,
			enum: Object.values(AppointmentBookingStatus),
			default: AppointmentBookingStatus.Pending,
		},
		// Legacy field — kept for backward compat; new code uses meetingUrl
		meetingLink: { type: String, default: undefined },
		// Cal ID fields
		calIdBookingId: { type: String, default: undefined },
		calIdEventId: { type: String, default: undefined },
		calIdEventTypeId: { type: String, default: undefined },
		meetingUrl: { type: String, default: undefined },
		timezone: {
			type: String,
			default: () => process.env.CALID_DEFAULT_TIMEZONE ?? "Asia/Kolkata",
		},
		appointmentStart: { type: Date, default: undefined },
		appointmentEnd: { type: Date, default: undefined },
		// Legacy date field — kept for backward compat
		appointmentDate: { type: Date, default: undefined },
		webhookSyncStatus: {
			type: String,
			enum: Object.values(WebhookSyncStatus),
			default: undefined,
		},
		appointmentSource: {
			type: String,
			enum: Object.values(AppointmentSource),
			default: AppointmentSource.UserApp,
		},
		appointmentMode: {
			type: String,
			enum: Object.values(AppointmentMode),
			default: AppointmentMode.ONLINE,
		},
		cancelledAt: { type: Date, default: undefined },
		cancelReason: { type: String, default: undefined },
		cancelledBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		rescheduledFromId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			default: undefined,
		},
		rescheduledToId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ExpertAppointment",
			default: undefined,
		},
		lastSyncedAt: { type: Date, default: undefined },
		// Idempotency key to prevent double-booking from concurrent requests
		idempotencyKey: { type: String, default: undefined },
	},
	{ timestamps: true },
);

// Partial unique index: one active booking per user per expert type.
// Cancelled/Completed/NoShow records are excluded so users can re-book.
// NOTE: Before deploying, drop the old full unique index on { userId, expertType }
// via MongoDB shell: db.expertappointments.dropIndex("userId_1_expertType_1")
expertAppointmentSchema.index(
	{ userId: 1, expertType: 1 },
	{
		unique: true,
		partialFilterExpression: {
			bookingStatus: {
				$in: [
					AppointmentBookingStatus.Pending,
					AppointmentBookingStatus.Confirmed,
					AppointmentBookingStatus.Rescheduled,
				],
			},
		},
		name: "expert_appointment_active_unique",
	},
);

// Sparse unique on idempotency key — prevents duplicate concurrent booking requests
expertAppointmentSchema.index(
	{ idempotencyKey: 1 },
	{ unique: true, sparse: true, name: "expert_appointment_idempotency" },
);

expertAppointmentSchema.index({ calIdBookingId: 1 }, { sparse: true });
expertAppointmentSchema.index({ userId: 1, bookingStatus: 1 });

type ExpertAppointmentDocument = mongoose.InferSchemaType<
	typeof expertAppointmentSchema
>;

export default (mongoose.models
	.ExpertAppointment as mongoose.Model<ExpertAppointmentDocument>) ||
	mongoose.model<ExpertAppointmentDocument>(
		"ExpertAppointment",
		expertAppointmentSchema,
	);
