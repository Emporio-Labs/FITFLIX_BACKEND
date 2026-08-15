import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const classSchema = new mongoose.Schema(
	{
		_id: {
			type: String,
			default: () => randomUUID(),
		},
		// Branch this class runs at.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		name: {
			type: String,
			required: true,
			trim: true,
		},
		description: {
			type: String,
			default: "",
			trim: true,
		},
		mode: {
			type: String,
			enum: ["online", "offline", "hybrid"],
			default: "offline",
		},
		sessionType: {
			type: String,
			enum: ["group_class", "live_stream", ""],
			default: "",
		},
		instructor: {
			type: String,
			default: "Staff",
			trim: true,
		},
		// User account that hosts this class — determines host vs audience role
		// in ZEGOCLOUD live streaming (GCLS-24). Distinct from the `instructor`
		// display-name string which remains for backwards compatibility.
		instructorUserId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		durationMinutes: {
			type: Number,
			default: 60,
			min: 1,
		},
		maxParticipants: {
			type: Number,
			default: 20,
			min: 1,
		},
		tags: {
			type: [String],
			default: [],
		},
		scheduleInfo: {
			type: String,
			default: "",
		},
		recurrenceRule: {
			type: String,
			enum: ["NONE", "DAILY", "WEEKLY", "MONTHLY"],
			default: "NONE",
		},
		schedulePattern: {
			type: String,
			default: null,
		},
		scheduleType: {
			type: String,
			default: "Fixed Session",
		},
		daysOfWeek: {
			type: [Number],
			default: [],
		},
		locationAddress: {
			type: String,
			default: "",
		},
		streamRoomId: {
			type: String,
			default: "",
		},
		enableWaitlist: {
			type: Boolean,
			default: false,
		},
		status: {
			type: String,
			enum: ["ACTIVE", "INACTIVE"],
			default: "ACTIVE",
			required: true,
			index: true,
		},
		access: {
			type: String,
			enum: ["members_only", "open_to_all"],
			default: "members_only",
		},
		bookingRequirement: {
			type: String,
			enum: ["free", "credits_required"],
			default: "credits_required",
		},
		creditCost: {
			type: Number,
			required: true,
			min: 0,
		},
		bookingWindowValue: {
			type: Number,
			default: 72,
			min: 0,
		},
		bookingWindowUnit: {
			type: String,
			enum: ["hours", "days"],
			default: "hours",
		},
		bookingCloseValue: {
			type: Number,
			default: null,
			min: 0,
		},
		bookingCloseUnit: {
			type: String,
			enum: ["minutes", "hours", "days"],
			default: null,
		},
		occurrenceLeadMinutes: {
			type: Number,
			default: 30,
			min: 0,
		},
		isPublished: {
			type: Boolean,
			default: true,
		},

		// ── Events ──
		// A class is already a recurring template with capacity, credits and a
		// booking window, so an event is the same entity with a bounded run and
		// cohort enrolment rather than a model of its own.

		// Also what the class rail and detail cards render. Without it the app
		// draws a flat colour block with an icon.
		imageUrl: {
			type: String,
			default: "",
			trim: true,
		},
		// drop_in keeps the per-occurrence booking every existing class uses.
		// batch enrols once across the whole run.
		format: {
			type: String,
			enum: ["drop_in", "batch"],
			default: "drop_in",
		},
		// Bounded run. Batch only — a drop_in class runs until it is retired.
		startDate: {
			type: Date,
			default: null,
		},
		endDate: {
			type: Date,
			default: null,
		},
		// Absolute enrolment window for a batch. Deliberately distinct from
		// bookingWindowValue/bookingCloseValue, which are offsets relative to
		// each occurrence's start — a cohort opens and closes once, on a date.
		enrollmentOpensAt: {
			type: Date,
			default: null,
		},
		enrollmentClosesAt: {
			type: Date,
			default: null,
		},
	},
	{
		timestamps: true,
	},
);

type ClassDocument = mongoose.InferSchemaType<typeof classSchema>;

export default (mongoose.models.Class as mongoose.Model<ClassDocument>) ||
	mongoose.model<ClassDocument>("Class", classSchema);
