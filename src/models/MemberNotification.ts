import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * FX-20.3 — a club-wide member broadcast ("announcement").
 *
 * One row per send. `locationId: null` is company-wide — it reaches every
 * club's members; a concrete Location id reaches only that club's members.
 * `audience` narrows further to a membership segment (all / active / lapsed).
 *
 * This row is the source of truth for the staff "Sent" history and for the
 * recipient count. Per-member delivery is fanned out into the in-app
 * Notification inbox at send time (see member-notification.controller), so the
 * Release-2 member app can surface it through the existing /notifications feed.
 */

export const MEMBER_NOTIFICATION_AUDIENCES = ["all", "member", "lapsed"] as const;

const memberNotificationSchema = new mongoose.Schema(
	{
		title: { type: String, required: true, trim: true },
		body: { type: String, required: true, trim: true },
		// Null = company-wide. A concrete branch = that club's members only. This
		// is the field the FX-20.3 targeting resolves recipients from.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		audience: {
			type: String,
			enum: MEMBER_NOTIFICATION_AUDIENCES,
			default: "all",
		},
		// Who sent it — id for audit, name for the Sent-table display column.
		sentById: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
		sentBy: { type: String, default: "" },
		// How many members the backend resolved as recipients at send time — the
		// evidence that a club broadcast reached only that club's members.
		recipientCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

// Serves the staff "Sent" history: branch-scoped and company-wide, newest first.
memberNotificationSchema.index({ locationId: 1, createdAt: -1 });
memberNotificationSchema.index({ createdAt: -1 });

applyIdTransform(memberNotificationSchema);

type MemberNotificationDocument = mongoose.InferSchemaType<
	typeof memberNotificationSchema
>;

export default (mongoose.models
	.MemberNotification as mongoose.Model<MemberNotificationDocument>) ||
	mongoose.model<MemberNotificationDocument>(
		"MemberNotification",
		memberNotificationSchema,
	);
