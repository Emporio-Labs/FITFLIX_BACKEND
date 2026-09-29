import mongoose from "mongoose";
import {
	branchOf,
	homeBranchOf,
	locationStampPlugin,
} from "../utils/location-stamp.plugin";
import { BookingStatus } from "./Enums";

const bookingSchema = new mongoose.Schema(
	{
		// Branch this record belongs to (FX-01). Filled on create by
		// locationStampPlugin when the caller doesn't pass one.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
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

bookingSchema.plugin(locationStampPlugin, {
	model: "Booking",
	// A booking takes the branch of what it books (FX-01.2): the class
	// (directly, or through the scheduled session), else the slot; then the
	// member's home branch. ScheduledSession has no branch of its own.
	derive: async (doc) => {
		const sessionClassId = doc.get("sessionId")
			? (
					await mongoose
						.model("ScheduledSession")
						.findById(doc.get("sessionId"))
						.select("classId")
						.lean<{ classId?: string }>()
				)?.classId
			: null;
		return (
			(await branchOf("Class", doc.get("classId") ?? sessionClassId)) ??
			(await branchOf("Slot", doc.get("slot"))) ??
			(await homeBranchOf(doc.get("user")))
		);
	},
});

export default (mongoose.models.Booking as mongoose.Model<BookingDocument>) ||
	mongoose.model<BookingDocument>("Booking", bookingSchema);
