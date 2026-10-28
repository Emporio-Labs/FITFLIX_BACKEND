import mongoose from "mongoose";
import { locationStampPlugin } from "../utils/location-stamp.plugin";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { LeadStatus } from "./Enums";

const leadSchema = new mongoose.Schema(
	{
		// Branch this record belongs to (FX-01). Filled on create by
		// locationStampPlugin when the caller doesn't pass one.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		leadName: { type: String, required: true },
		// Optional: phone-auth (app) leads have no email and are keyed by phone.
		email: { type: String, default: "" },
		phone: { type: String, default: "" },
		source: { type: String, default: "" },
		status: {
			type: String,
			enum: Object.values(LeadStatus),
			default: LeadStatus.New,
			required: true,
		},
		interestedIn: { type: String, default: "" },
		notes: { type: String, default: "" },
		tags: { type: [String], default: [] },
		publicCapture: { type: mongoose.Schema.Types.Mixed, default: null },
		followUpDate: { type: Date, default: null },
		slaDeadline: { type: Date, default: null },
		isEscalated: { type: Boolean, default: false },
		owner: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
		// Display name of `owner`, kept beside it because an owner may be an
		// Admin or a Trainer and `owner` can only populate one collection.
		ownerName: { type: String, default: "" },
		convertedUser: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		// ── Worked-lead summary, kept in step with LeadActivity ──────────
		// Written by recordLeadOutcome; the timeline itself lives in
		// LeadActivity. Old leads default to empty and fill in as staff log.
		temperature: {
			type: String,
			enum: ["hot", "warm", "cold", null],
			default: null,
		},
		visitAt: { type: Date, default: null },
		attemptCount: { type: Number, default: 0 },
		noAnswerStreak: { type: Number, default: 0 },
		firstAttemptAt: { type: Date, default: null },
		lastAttemptAt: { type: Date, default: null },
		firstContactedAt: { type: Date, default: null },
		lastContactedAt: { type: Date, default: null },
		lastOutcome: { type: String, default: "" },
		lostReason: { type: String, default: "" },
	},
	{ timestamps: true },
);

// Lead responses must expose `_id` (read directly by clients/tests as `lead._id`)
// while still keeping the `id` virtual for backward compatibility. We intentionally
// do NOT use the shared `applyIdTransform` here — that helper strips `_id`, and the
// requirement is to change only the Lead model without touching the shared utility or
// any other model's serialization.
leadSchema.set("toJSON", {
	virtuals: true,
	transform: (_doc, ret: Record<string, unknown>) => {
		delete ret.__v;
		return ret;
	},
});

type LeadDocument = mongoose.InferSchemaType<typeof leadSchema>;

leadSchema.plugin(locationStampPlugin, { model: "Lead" });

export default (mongoose.models.Lead as mongoose.Model<LeadDocument>) ||
	mongoose.model<LeadDocument>("Lead", leadSchema);
