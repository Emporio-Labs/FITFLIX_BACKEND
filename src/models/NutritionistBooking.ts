import mongoose from "mongoose";
import {
	AppointmentMode,
	MeetingStatus,
	NutritionistBookingStatus,
} from "./Enums";

const nutritionistBookingSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		slotId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			default: null,
		},
		bookingDate: {
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
		appointmentMode: {
			type: String,
			enum: Object.values(AppointmentMode),
			default: AppointmentMode.ONLINE,
			required: true,
		},
		clinicLocation: {
			type: String,
			default: null,
		},
		zegoRoomId: {
			type: String,
			sparse: true,
			default: null,
		},
		assignedNutritionistId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		assignedNutritionistName: {
			type: String,
			default: null,
		},
		meetingStatus: {
			type: String,
			enum: Object.values(MeetingStatus),
			default: MeetingStatus.SCHEDULED,
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(NutritionistBookingStatus),
			default: NutritionistBookingStatus.PENDING,
			required: true,
		},
		notes: {
			type: String,
			default: null,
		},
		acceptedAt: {
			type: Date,
			default: null,
		},
		completedAt: {
			type: Date,
			default: null,
		},
	},
	{ timestamps: true },
);

nutritionistBookingSchema.index({ userId: 1, status: 1 });
nutritionistBookingSchema.index({ bookingDate: 1, status: 1 });

type NutritionistBookingDocument = mongoose.InferSchemaType<
	typeof nutritionistBookingSchema
>;

export default (mongoose.models
	.NutritionistBooking as mongoose.Model<NutritionistBookingDocument>) ||
	mongoose.model<NutritionistBookingDocument>(
		"NutritionistBooking",
		nutritionistBookingSchema,
	);
