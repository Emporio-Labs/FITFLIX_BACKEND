import mongoose from "mongoose";

import {
	AppointmentBookingStatus,
	AppointmentMode,
	ExpertType,
	MeetingStatus,
} from "./Enums";

const expertAppointmentSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		expertType: {
			type: String,
			enum: [ExpertType.SportsScientist],
			default: ExpertType.SportsScientist,
			required: true,
		},
		appointmentDate: { type: Date, required: true },
		startTime: { type: String, default: null },
		endTime: { type: String, default: null },
		appointmentMode: {
			type: String,
			enum: Object.values(AppointmentMode),
			default: AppointmentMode.IN_PERSON,
			required: true,
		},
		meetingLink: { type: String, default: null },
		meetingStatus: {
			type: String,
			enum: Object.values(MeetingStatus),
			default: MeetingStatus.SCHEDULED,
		},
		bookingStatus: {
			type: String,
			enum: Object.values(AppointmentBookingStatus),
			default: AppointmentBookingStatus.Pending,
		},
		notes: { type: String, default: null },
	},
	{ timestamps: true },
);

expertAppointmentSchema.index({ userId: 1, expertType: 1, bookingStatus: 1 });
expertAppointmentSchema.index({ appointmentDate: 1, bookingStatus: 1 });

export type ExpertAppointmentDocument = mongoose.InferSchemaType<
	typeof expertAppointmentSchema
>;

export default (mongoose.models
	.ExpertAppointment as mongoose.Model<ExpertAppointmentDocument>) ||
	mongoose.model<ExpertAppointmentDocument>(
		"ExpertAppointment",
		expertAppointmentSchema,
	);
