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
			ref: "HpodReport",
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
		cancelledAt: {
			type: Date,
			required: false,
			default: null,
		},
	},
	{ timestamps: true },
);

// ---------------------------------------------------------------------------
// Uniqueness guard: a user cannot have two active (non-cancelled) bookings
// for the exact same slot. This sparse partial index excludes documents
// where status === "Cancelled" so that re-bookings after cancellation work.
// ---------------------------------------------------------------------------
bookingSchema.index(
	{ user: 1, slot: 1 },
	{
		unique: true,
		partialFilterExpression: { status: { $ne: BookingStatus.Cancelled } },
		name: "unique_active_booking_per_user_slot",
	},
);

type BookingDocument = mongoose.InferSchemaType<typeof bookingSchema>;

export default (mongoose.models.Booking as mongoose.Model<BookingDocument>) ||
	mongoose.model<BookingDocument>("Booking", bookingSchema);
