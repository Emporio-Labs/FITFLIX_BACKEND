import mongoose from "mongoose";
import {
	AppointmentMode,
	NutritionistApprovalStatus,
	NutritionistBookingStatus,
} from "./Enums";

const nutritionistBookingSchema = new mongoose.Schema(
	{
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		slot: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			required: true,
			index: true,
		},
		date: { type: Date, required: true },
		startTime: { type: String, required: true },
		endTime: { type: String, required: true },
		appointmentMode: {
			type: String,
			enum: Object.values(AppointmentMode),
			required: true,
		},
		bookingStatus: {
			type: String,
			enum: Object.values(NutritionistBookingStatus),
			default: NutritionistBookingStatus.PENDING,
			required: true,
			index: true,
		},
		nutritionistApprovalStatus: {
			type: String,
			enum: Object.values(NutritionistApprovalStatus),
			default: NutritionistApprovalStatus.PENDING,
			required: true,
		},
		meetingLink: { type: String, default: null },
		calBookingId: { type: String, default: null },
		clinicLocation: { type: String, default: null },
		rejectionReason: { type: String, default: null },
		acceptedAt: { type: Date, default: null },
		rejectedAt: { type: Date, default: null },
		completedAt: { type: Date, default: null },
		approvedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
		},
	},
	{ timestamps: true },
);

nutritionistBookingSchema.index(
	{ user: 1, bookingStatus: 1 },
	{
		partialFilterExpression: {
			bookingStatus: { $in: ["PENDING", "ACCEPTED"] },
		},
	},
);

type NutritionistBookingDocument = mongoose.InferSchemaType<
	typeof nutritionistBookingSchema
>;

export default (mongoose.models.NutritionistBooking as mongoose.Model<NutritionistBookingDocument>) ||
	mongoose.model<NutritionistBookingDocument>(
		"NutritionistBooking",
		nutritionistBookingSchema,
	);
