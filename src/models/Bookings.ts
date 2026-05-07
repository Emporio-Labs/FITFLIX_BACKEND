import mongoose from "mongoose";
import { BookingStatus } from "./Enums";

const bookingSchema = new mongoose.Schema(
	{
		bookingDate: { type: Date, required: true },
		startTime: { type: String, required: true },
		endTime: { type: String, required: true },
		status: {
			type: String,
			enum: Object.values(BookingStatus),
			default: BookingStatus.Booked,
			required: true,
		},
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
		service: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Service",
			required: true,
		},
		report: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Report",
			default: null,
			required: false,
		},
		creditCostSnapshot: {
			type: Number,
			min: 1,
			default: 1,
			required: true,
		},
		creditsBypassed: {
			type: Boolean,
			default: false,
			required: true,
		},
	},
	{ timestamps: true },
);

type BookingDocument = mongoose.InferSchemaType<typeof bookingSchema>;

export default (mongoose.models.Booking as mongoose.Model<BookingDocument>) ||
	mongoose.model<BookingDocument>("Booking", bookingSchema);
