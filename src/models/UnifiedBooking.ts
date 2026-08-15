import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import {
	AppointmentMode,
	MeetingStatus,
	ServiceCategory,
	ServiceSubtype,
	UnifiedBookingStatus,
} from "./Enums";

const exerciseCompletedItemSchema = new mongoose.Schema(
	{
		exerciseId: { type: String, default: null },
		name: { type: String, required: true },
		sets: { type: Number, required: true, default: 3 },
		reps: { type: Number, required: true, default: 10 },
		weight: { type: Number, default: 0 },
		notes: { type: String, default: "" },
	},
	{ _id: false },
);

const sessionNotesSchema = new mongoose.Schema(
	{
		workoutNotes: { type: String, default: "" },
		exercisesCompleted: { type: [exerciseCompletedItemSchema], default: [] },
		clinicalNotes: { type: String, default: "" },
		dietaryAdvice: { type: String, default: "" },
	},
	{ _id: false },
);

const adminResolutionSchema = new mongoose.Schema(
	{
		isReversible: { type: Boolean, default: false },
		resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
		resolvedAt: { type: Date, default: null },
		resolutionNotes: { type: String, default: "" },
	},
	{ _id: false },
);

const unifiedBookingSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		serviceCategory: {
			type: String,
			enum: Object.values(ServiceCategory),
			default: ServiceCategory.EXPERT_SESSION,
			required: true,
			index: true,
		},
		serviceSubtype: {
			type: String,
			enum: Object.values(ServiceSubtype),
			default: ServiceSubtype.TRAINER,
			required: true,
			index: true,
		},
		expertId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			default: null,
			index: true,
		},
		assignedExpertName: {
			type: String,
			default: "",
		},
		packageId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Membership",
			default: null,
		},
		slotId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			default: null,
		},
		bookingDate: {
			type: Date,
			required: true,
			index: true,
		},
		startTime: {
			type: String,
			required: true, // "HH:MM" e.g. "07:00"
		},
		endTime: {
			type: String,
			required: true, // "HH:MM" e.g. "07:45"
		},
		appointmentMode: {
			type: String,
			enum: Object.values(AppointmentMode),
			default: AppointmentMode.ONLINE,
			required: true,
		},
		// The branch this session belongs to. Distinct from `location` below,
		// which is free-text venue copy shown to the member ("Online Video
		// Room", "FitFlix Sainikpuri"). This one drives scoping and attribution.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
		location: {
			type: String,
			default: "Online Video Room",
		},
		status: {
			type: String,
			enum: Object.values(UnifiedBookingStatus),
			default: UnifiedBookingStatus.CONFIRMED,
			required: true,
			index: true,
		},
		meetingStatus: {
			type: String,
			enum: Object.values(MeetingStatus),
			default: MeetingStatus.SCHEDULED,
			required: true,
		},
		zegoRoomId: {
			type: String,
			sparse: true,
			default: null,
		},
		hostLiveAt: {
			type: Date,
			default: null,
		},
		hostLastSeenAt: {
			type: Date,
			default: null,
		},
		userJoinedAt: {
			type: Date,
			default: null,
		},
		completedAt: {
			type: Date,
			default: null,
		},
		hostNoShowAt: {
			type: Date,
			default: null,
		},
		consumptionModel: {
			type: String,
			enum: ["CREDIT_POOL", "DIRECT_PURCHASE"],
			default: "CREDIT_POOL",
			required: true,
		},
		creditCostSnapshot: {
			type: Number,
			default: 1,
			min: 0,
		},
		creditsBypassed: {
			type: Boolean,
			default: false,
		},
		invoiceId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Invoice",
			default: null,
		},
		sessionNotes: {
			type: sessionNotesSchema,
			default: () => ({}),
		},
		adminResolution: {
			type: adminResolutionSchema,
			default: () => ({}),
		},
	},
	{ timestamps: true },
);

// ── Unique Index Constraint for 1-on-1 Sessions (Prevents Double-Booking) ──
unifiedBookingSchema.index(
	{ expertId: 1, bookingDate: 1, startTime: 1 },
	{
		unique: true,
		partialFilterExpression: {
			status: { $in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED] },
			expertId: { $exists: true, $ne: null },
		},
	},
);

unifiedBookingSchema.index({ userId: 1, status: 1 });
// Per-branch schedule views and revenue attribution.
unifiedBookingSchema.index({ locationId: 1, bookingDate: 1, startTime: 1 });
unifiedBookingSchema.index({ bookingDate: 1, status: 1 });
unifiedBookingSchema.index({ serviceCategory: 1, serviceSubtype: 1, status: 1 });

applyIdTransform(unifiedBookingSchema);

type UnifiedBookingDocument = mongoose.InferSchemaType<
	typeof unifiedBookingSchema
>;

export default (mongoose.models
	.UnifiedBooking as mongoose.Model<UnifiedBookingDocument>) ||
	mongoose.model<UnifiedBookingDocument>(
		"UnifiedBooking",
		unifiedBookingSchema,
	);
