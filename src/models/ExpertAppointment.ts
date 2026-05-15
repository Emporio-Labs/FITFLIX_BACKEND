import mongoose from "mongoose";
import { AppointmentBookingStatus, ExpertType } from "./Enums";

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
		appointmentDate: { type: Date, default: undefined },
		meetingLink: { type: String, default: undefined },
		calComBookingId: { type: String, default: undefined },
	},
	{ timestamps: true },
);

expertAppointmentSchema.index({ userId: 1, expertType: 1 }, { unique: true });

type ExpertAppointmentDocument = mongoose.InferSchemaType<
	typeof expertAppointmentSchema
>;

export default (mongoose.models.ExpertAppointment as mongoose.Model<ExpertAppointmentDocument>) ||
	mongoose.model<ExpertAppointmentDocument>(
		"ExpertAppointment",
		expertAppointmentSchema,
	);
