import mongoose from "mongoose";
import { LocationError, resolveLocationId } from "../utils/location.resolver";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { LeadStatus } from "./Enums";

/**
 * FX-33.5 — an attributed action taken on a lead (note, call, status change).
 * `createdBy` is the staff account that performed it, so every call, note and
 * conversion is recorded against the person who claimed/worked the lead.
 */
const leadInteractionSchema = new mongoose.Schema(
	{
		type: {
			type: String,
			enum: ["note", "call", "whatsapp", "email", "status-change", "system"],
			default: "note",
		},
		note: { type: String, default: "" },
		createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
		createdByName: { type: String, default: "" },
		createdAt: { type: Date, default: Date.now },
	},
	{ _id: true },
);

const leadSchema = new mongoose.Schema(
	{
		// FX-33.1 — branch this lead belongs to. Filled on create (explicitly from
		// the X-Location-Id header, or by the pre-validate hook below from the sole
		// active branch). Indexed because the branch queue reads filter on it.
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
		// Display name of the staff member working this lead. Mirrored from a claim
		// (FX-33.2); the frontdesk board reads it as the "Assigned Staff" column.
		assignedStaffName: { type: String, default: "" },
		// FX-33.2 — the sales person / manager who claimed this lead. `claimedBy`
		// null means it sits unclaimed in the branch queue. Indexed for the queue
		// filter (unclaimed vs own).
		claimedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
			index: true,
		},
		claimedByName: { type: String, default: "" },
		claimedAt: { type: Date, default: null },
		// FX-33.5 — who converted this lead (may differ from the claimer; a manager
		// can convert on a sales person's behalf).
		convertedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
		},
		// FX-33.5 — attributed call/note history.
		interactions: { type: [leadInteractionSchema], default: [] },
		// Contact telemetry the frontdesk board reads; incremented by the
		// contact-attempt endpoint.
		contactCount: { type: Number, default: 0 },
		lastContactedAt: { type: Date, default: null },
		convertedUser: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

// Per-branch queue reads: "unclaimed / my leads at this branch in this stage".
leadSchema.index({ locationId: 1, claimedBy: 1, status: 1 });

/**
 * FX-33.1 — stamp a new lead with its branch when the caller didn't set one.
 * Mirrors the fx-01 locationStampPlugin intent, but scoped to Lead so this
 * change stays self-contained. Falls back to the sole active branch; on
 * ambiguity (several active, none named) or no branch seeded it leaves
 * locationId null rather than blocking the save.
 */
leadSchema.pre("validate", async function stampBranch() {
	if (this.isNew && !this.get("locationId")) {
		try {
			const resolved = await resolveLocationId();
			this.set("locationId", resolved);
		} catch (error) {
			// No branch, or more than one active and none named: save unstamped.
			// Anything that isn't that ambiguity is a real fault — rethrow it.
			if (!(error instanceof LocationError)) {
				throw error;
			}
		}
	}
});

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

export default (mongoose.models.Lead as mongoose.Model<LeadDocument>) ||
	mongoose.model<LeadDocument>("Lead", leadSchema);
