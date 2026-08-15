import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { LeadStatus } from "./Enums";

const leadSchema = new mongoose.Schema(
	{
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
		convertedUser: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
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

export default (mongoose.models.Lead as mongoose.Model<LeadDocument>) ||
	mongoose.model<LeadDocument>("Lead", leadSchema);
