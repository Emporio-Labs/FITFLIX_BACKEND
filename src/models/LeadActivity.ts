import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * One entry on a lead's timeline: a call/WhatsApp/visit outcome, a note, a
 * status change, or something the system did (lead created, enquired again,
 * signed up in the app, paid, escalated, auto-message queued).
 *
 * Append-only. The lead keeps a summary (status, temperature, counters) in
 * step; this is the history managers read and analytics are built from.
 */
const leadActivitySchema = new mongoose.Schema(
	{
		leadId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Lead",
			required: true,
			index: true,
		},
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
		type: {
			type: String,
			enum: ["call", "whatsapp", "visit", "note", "status_change", "system"],
			required: true,
		},
		// Outcome key from LEAD_OUTCOMES ("custom" for free text), or a
		// system event key such as "created" / "enquired_again" / "converted".
		outcome: { type: String, default: "" },
		// What the timeline shows: the outcome label, or the staff's own words.
		label: { type: String, default: "" },
		connected: { type: Boolean, default: false },
		note: { type: String, default: "" },
		statusFrom: { type: String, default: null },
		statusTo: { type: String, default: null },
		temperature: { type: String, default: null },
		lostReason: { type: String, default: "" },
		nextFollowUpAt: { type: Date, default: null },
		visitAt: { type: Date, default: null },
		createdBy: {
			id: { type: String, default: null },
			name: { type: String, default: "" },
			role: { type: String, default: "system" },
		},
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

leadActivitySchema.index({ leadId: 1, createdAt: -1 });
leadActivitySchema.index({ createdAt: -1, type: 1 });
leadActivitySchema.index({ "createdBy.id": 1, createdAt: -1 });

applyIdTransform(leadActivitySchema);

type LeadActivityDocument = mongoose.InferSchemaType<typeof leadActivitySchema>;

export default (mongoose.models.LeadActivity as mongoose.Model<LeadActivityDocument>) ||
	mongoose.model<LeadActivityDocument>("LeadActivity", leadActivitySchema);
