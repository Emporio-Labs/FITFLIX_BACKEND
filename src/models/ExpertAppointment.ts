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
		// Widened 2026-08-26 from a single-value enum (sports scientist only) so
		// this model can carry any future expert appointment type without a
		// migration; every existing/new writer still passes SportsScientist
		// explicitly (see onboarding.controller.ts), so the default is
		// unchanged and no backfill is needed.
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			default: ExpertType.SportsScientist,
			required: true,
		},
		appointmentDate: { type: Date, required: true },
		// Set only when the booking reserved a real Slot document's capacity
		// (see onboarding.controller.ts:bookSportsScientist). Needed so a
		// future cancel/reschedule endpoint can call releaseSlotCapacity —
		// without recording which slot was consumed, a reserved seat could
		// never be given back.
		slotId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			default: null,
		},
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
		clinicLocation: { type: String, default: null },
		assignedExpertId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		assignedExpertName: { type: String, default: null },
		acceptedAt: { type: Date, default: null },
		completedAt: { type: Date, default: null },
		rejectedAt: { type: Date, default: null },
		rejectionReason: { type: String, default: null },
		notes: { type: String, default: null },
	},
	{ timestamps: true },
);

expertAppointmentSchema.index({ userId: 1, expertType: 1, bookingStatus: 1 });
expertAppointmentSchema.index({ appointmentDate: 1, bookingStatus: 1 });
expertAppointmentSchema.index({ expertType: 1, bookingStatus: 1, appointmentDate: 1 });

export type ExpertAppointmentDocument = mongoose.InferSchemaType<
	typeof expertAppointmentSchema
>;

export default (mongoose.models
	.ExpertAppointment as mongoose.Model<ExpertAppointmentDocument>) ||
	mongoose.model<ExpertAppointmentDocument>(
		"ExpertAppointment",
		expertAppointmentSchema,
	);
