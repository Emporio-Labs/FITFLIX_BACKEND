import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { CANONICAL_APPOINTMENT_MODES } from "../utils/appointment-mode";
import { AppointmentMode, ExpertType } from "./Enums";

const shiftConfigSchema = new mongoose.Schema(
	{
		startTime: {
			type: String,
			required: true,
		},
		endTime: {
			type: String,
			required: true,
		},
	},
	{ _id: false },
);

const weeklySlotConfigSchema = new mongoose.Schema(
	{
		dayOfWeek: {
			type: Number,
			required: true,
			min: 0, // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
			max: 6,
		},
		startTime: {
			type: String,
			required: false, // "06:00"
		},
		endTime: {
			type: String,
			required: false, // "20:00"
		},
		shifts: {
			type: [shiftConfigSchema],
			default: undefined,
		},
		isAvailable: {
			type: Boolean,
			default: true,
		},
	},
	{ _id: false },
);

const expertScheduleSchema = new mongoose.Schema(
	{
		expertId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			unique: true,
			index: true,
			refPath: "expertModel",
		},
		expertModel: {
			type: String,
			enum: ["Trainer", "User"],
			default: "Trainer",
			required: true,
		},
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			default: ExpertType.Trainer,
			required: true,
			index: true,
		},
		weeklySlots: {
			type: [weeklySlotConfigSchema],
			default: () => [
				{ dayOfWeek: 1, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Mon
				{ dayOfWeek: 2, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Tue
				{ dayOfWeek: 3, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Wed
				{ dayOfWeek: 4, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Thu
				{ dayOfWeek: 5, startTime: "07:00", endTime: "19:00", isAvailable: true }, // Fri
				{ dayOfWeek: 6, startTime: "08:00", endTime: "16:00", isAvailable: true }, // Sat
				{ dayOfWeek: 0, startTime: "08:00", endTime: "14:00", isAvailable: false }, // Sun
			],
		},
		slotDurationMinutes: {
			type: Number,
			default: 45,
			min: 15,
			max: 120,
		},
		bufferMinutes: {
			type: Number,
			default: 15,
			min: 0,
			max: 60,
		},
		blackoutDates: {
			type: [Date],
			default: [],
		},
		// Which appointment modes this expert actually offers. One nutritionist
		// may be online-only while another also takes in-person consultations,
		// so availability has to depend on the mode the member picked — see
		// calculateAvailableSlots. Only the two canonical values are stored;
		// `AppointmentMode.OFFLINE` is folded to IN_PERSON on write
		// (utils/appointment-mode.ts) so a third value can never reach the
		// availability filter.
		supportedModes: {
			type: [String],
			enum: CANONICAL_APPOINTMENT_MODES,
			default: () => [AppointmentMode.IN_PERSON, AppointmentMode.ONLINE],
		},
		// How far ahead a member may book. This is now *enforced* by
		// calculateAvailableSlots and echoed in every availability response so
		// the client's date picker clamps to the server instead of offering
		// days the server will refuse. The default was 14 while the member
		// app's picker allowed 60 — they disagreed silently, and 60 is the
		// behaviour that was actually live, so that is what it reconciles to.
		maxAdvanceBookingDays: {
			type: Number,
			default: 60,
			min: 1,
			max: 365,
		},
		isActive: {
			type: Boolean,
			default: true,
		},
	},
	{ timestamps: true },
);

// Pooled availability sweeps every active expert of one type for a date, so
// the type + active pair is the access path, not expertId.
expertScheduleSchema.index({ expertType: 1, isActive: 1 });

applyIdTransform(expertScheduleSchema);

type ExpertScheduleDocument = mongoose.InferSchemaType<
	typeof expertScheduleSchema
>;

export default (mongoose.models
	.ExpertSchedule as mongoose.Model<ExpertScheduleDocument>) ||
	mongoose.model<ExpertScheduleDocument>(
		"ExpertSchedule",
		expertScheduleSchema,
	);
