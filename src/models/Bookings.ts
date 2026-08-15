import mongoose from "mongoose";
import { BookingStatus } from "./Enums";

const bookingSchema = new mongoose.Schema(
	{
		bookingDate: { type: Date, required: true },
		startTime: { type: String, required: true },
		endTime: { type: String, required: true },
		status: {
			type: String,
			enum: [...Object.values(BookingStatus), "Confirmed", "Pending", "Consumed"],
			default: BookingStatus.Booked,
			required: true,
		},
		user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
		slot: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			required: false,
			default: null,
		},
		service: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Service",
			required: false,
			default: null,
		},
		sessionId: {
			type: String,
			ref: "ScheduledSession",
			default: null,
			index: true,
		},
		classId: {
			type: String,
			ref: "Class",
			default: null,
		},
		report: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "MedicalReport",
			default: null,
			required: false,
		},
		creditCostSnapshot: {
			type: Number,
			min: 0,
			default: 1,
			required: true,
		},
		creditsBypassed: {
			type: Boolean,
			default: false,
			required: true,
		},
		joinedAt: { type: Date, default: null },
		leftAt: { type: Date, default: null },
		stayDurationMinutes: { type: Number, default: 0 },
	},
	{ timestamps: true },
);

bookingSchema.index({ user: 1, sessionId: 1 });

type BookingDocument = mongoose.InferSchemaType<typeof bookingSchema>;

export default (mongoose.models.Booking as mongoose.Model<BookingDocument>) ||
	mongoose.model<BookingDocument>("Booking", bookingSchema);
