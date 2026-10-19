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
		// Polymorphic, mirroring what ExpertSchedule already does. Trainers are
		// their own collection; nutritionists, sports scientists and doctors are
		// `User` documents carrying `staffRole`. Before this, `expertId` was
		// hard-reffed to "Trainer", which is why nutritionist consultations
		// needed a separate collection at all.
		expertId: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: "expertModel",
			default: null,
			index: true,
		},
		expertModel: {
			type: String,
			enum: ["Trainer", "User"],
			default: "Trainer",
			required: true,
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
		// Derived slot-occupancy flag, maintained by the hooks below — NEVER set
		// by application code directly. It is `true` exactly while this booking
		// holds its expert's slot (status PENDING/CONFIRMED and an expert
		// assigned) and absent otherwise. The unique index at the bottom filters
		// on `{ slotHold: true }`: a plain equality expression, which every
		// MongoDB version accepts in a partialFilterExpression. The previous
		// filter used `status: { $in: [...] }` and `expertId: { $ne: null }` —
		// operators MongoDB rejects at index-build time, so (with autoIndex
		// swallowing the error) the double-booking guard silently never built.
		slotHold: {
			type: Boolean,
			// `sparse`-friendly: the field is unset (not `false`) for freed slots,
			// so terminal-state rows drop out of the partial index entirely and a
			// cancelled slot becomes re-bookable.
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
		// ── Consultation lifecycle ───────────────────────────────────────────
		// Carried over from NutritionistBooking. A 1:1 consultation is requested
		// by the member and accepted or declined by staff, so it has an audit
		// trail a personal-training booking (auto-confirmed) never needed.
		acceptedAt: { type: Date, default: null },
		rejectedAt: { type: Date, default: null },
		rejectionReason: { type: String, default: null },
		cancelledAt: { type: Date, default: null },
		cancelledBy: {
			type: String,
			enum: ["user", "admin", null],
			default: null,
		},
		cancellationReason: { type: String, default: null },
		// Free-text note the member attached when requesting the appointment.
		// Distinct from `sessionNotes.dietaryAdvice`, which the expert writes
		// afterwards.
		memberNotes: { type: String, default: null },
	},
	{ timestamps: true },
);

// ── slotHold maintenance ───────────────────────────────────────────────────
// A booking "holds" its expert's slot while it is PENDING or CONFIRMED and has
// an expert assigned. The flag is derived centrally here so the ~15 scattered
// status-write sites (nutritionist / expert-appointment controllers, expiry and
// no-show sweeps, cancellation, completion) never have to remember to touch it.
const SLOT_HOLD_STATUSES: ReadonlyArray<string> = [
	UnifiedBookingStatus.PENDING,
	UnifiedBookingStatus.CONFIRMED,
];

function shouldHoldSlot(status: unknown, expertId: unknown): boolean {
	return (
		typeof status === "string" &&
		SLOT_HOLD_STATUSES.includes(status) &&
		expertId != null
	);
}

// Document saves: `new UnifiedBooking(...).save()` and `Model.create(...)`.
// Written as synchronous hooks (no `next` callback) — mongoose runs them to
// completion before proceeding.
unifiedBookingSchema.pre("save", function () {
	if (shouldHoldSlot(this.status, this.expertId)) {
		this.slotHold = true;
	} else {
		// Setting to `undefined` unsets the field on save, keeping terminal-state
		// rows out of the partial unique index.
		this.set("slotHold", undefined);
	}
});

// Atomic updates that change status: findOneAndUpdate / updateOne / updateMany.
unifiedBookingSchema.pre(
	["findOneAndUpdate", "updateOne", "updateMany"],
	function () {
		const update = this.getUpdate() as Record<string, any> | null;
		if (!update) {
			return;
		}

		const set = update.$set ?? {};
		// Only react when the update actually changes status; otherwise leave the
		// existing slotHold untouched (an unrelated update must not clear it).
		const nextStatus = set.status !== undefined ? set.status : update.status;
		if (nextStatus === undefined) {
			return;
		}

		// expertId is rarely part of a status-change update; fall back to "held
		// unless it is being explicitly nulled", which matches every real flow
		// (expert bookings always carry an expertId).
		const nextExpertId =
			set.expertId !== undefined
				? set.expertId
				: update.expertId !== undefined
					? update.expertId
					: // not in the update → assume present (expert sessions always set it)
						"__present__";

		if (shouldHoldSlot(nextStatus, nextExpertId)) {
			update.$set = { ...set, slotHold: true };
			if (update.$unset) delete update.$unset.slotHold;
		} else {
			update.$unset = { ...(update.$unset ?? {}), slotHold: "" };
			if (update.$set) delete update.$set.slotHold;
		}
		this.setUpdate(update);
	},
);

// ── Unique Index Constraint for 1-on-1 Sessions (Prevents Double-Booking) ──
// Keyed on {expertId, bookingDate, startTime}; the partial filter is a single
// equality (`slotHold: true`) so it is portable across MongoDB versions. Only
// slot-holding (active) bookings participate, so exactly one PENDING/CONFIRMED
// booking can exist per expert/date/start-time — the structural guarantee the
// concurrent overlap check in unified-booking.service.ts cannot provide alone.
unifiedBookingSchema.index(
	{ expertId: 1, bookingDate: 1, startTime: 1 },
	{
		unique: true,
		partialFilterExpression: { slotHold: true },
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
