import mongoose from "mongoose";
import { AuditAction } from "./Enums";

const appointmentAuditLogSchema = new mongoose.Schema(
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
		action: {
			type: String,
			enum: Object.values(AuditAction),
			required: true,
		},
		// Who triggered this — "user", "admin", "webhook", "system"
		actor: { type: String, required: true },
		actorId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		calBookingId: { type: String, default: undefined },
		before: { type: mongoose.Schema.Types.Mixed, default: undefined },
		after: { type: mongoose.Schema.Types.Mixed, default: undefined },
		// Raw payload (e.g. webhook body) for debugging
		payload: { type: mongoose.Schema.Types.Mixed, default: undefined },
	},
	{ timestamps: true },
);

appointmentAuditLogSchema.index({ appointmentId: 1, createdAt: -1 });
appointmentAuditLogSchema.index({ userId: 1, createdAt: -1 });

type AppointmentAuditLogDocument = mongoose.InferSchemaType<
	typeof appointmentAuditLogSchema
>;

export default (mongoose.models
	.AppointmentAuditLog as mongoose.Model<AppointmentAuditLogDocument>) ||
	mongoose.model<AppointmentAuditLogDocument>(
		"AppointmentAuditLog",
		appointmentAuditLogSchema,
	);
