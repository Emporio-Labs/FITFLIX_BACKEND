import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { RegistrationPaymentStatus } from "./Enums";

const eventRegistrationSchema = new mongoose.Schema(
	{
		eventId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "FitflixEvent",
			required: true,
			index: true,
		},
		tierId: {
			type: String,
			required: true,
			trim: true,
		},
		tierName: {
			type: String,
			required: true,
			trim: true,
		},
		ticketId: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			uppercase: true,
			index: true,
		},
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
			index: true,
		},
		attendeeName: {
			type: String,
			required: true,
			trim: true,
		},
		attendeeEmail: {
			type: String,
			required: true,
			trim: true,
			lowercase: true,
			index: true,
		},
		attendeePhone: {
			type: String,
			required: true,
			trim: true,
			index: true,
		},
		answers: {
			type: Map,
			of: String,
			default: {},
		},
		paymentStatus: {
			type: String,
			enum: Object.values(RegistrationPaymentStatus),
			default: RegistrationPaymentStatus.Free,
			required: true,
			index: true,
		},
		paymentReference: {
			type: String,
			default: null,
		},
		amountPaid: {
			type: Number,
			default: 0,
			min: 0,
		},
		assignedKitCollected: {
			type: Boolean,
			default: false,
		},
		verificationToken: {
			type: String,
			required: true,
			index: true,
		},
		passUrl: {
			type: String,
			default: null,
		},
		checkedIn: {
			type: Boolean,
			default: false,
			index: true,
		},
		checkedInAt: {
			type: Date,
			default: null,
		},
		checkedInByStaffId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
		},
		checkInNotes: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true },
);

eventRegistrationSchema.index({ eventId: 1, attendeeEmail: 1 }, { unique: true });
eventRegistrationSchema.index({ eventId: 1, attendeePhone: 1 }, { unique: true });
eventRegistrationSchema.index({ eventId: 1, checkedIn: 1 });

applyIdTransform(eventRegistrationSchema);

type EventRegistrationDocument = mongoose.InferSchemaType<typeof eventRegistrationSchema>;

export default (mongoose.models.EventRegistration as mongoose.Model<EventRegistrationDocument>) ||
	mongoose.model<EventRegistrationDocument>("EventRegistration", eventRegistrationSchema);
