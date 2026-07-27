import mongoose from "mongoose";
import { applyAppendOnlyGuard } from "../utils/mongoose-append-only";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ModerationActionType, ModerationTargetType } from "./Enums";

/**
 * APPEND-ONLY moderation audit log. Every admin action writes one immutable row;
 * rows are never updated or deleted. Enforced at the data-access layer by
 * {@link applyAppendOnlyGuard} (and, when applied, the restricted DB role from
 * scripts/community-setup.ts).
 */
const moderationActionSchema = new mongoose.Schema(
	{
		adminId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			required: true,
		},
		action: {
			type: String,
			enum: Object.values(ModerationActionType),
			required: true,
		},
		targetType: {
			type: String,
			enum: Object.values(ModerationTargetType),
			required: true,
		},
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		reason: { type: String, default: "" },
	},
	// Append-only: keep createdAt, drop updatedAt (a row is never updated).
	{ timestamps: { createdAt: true, updatedAt: false } },
);

moderationActionSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
moderationActionSchema.index({ adminId: 1, createdAt: -1 });

applyAppendOnlyGuard(moderationActionSchema, "moderation_actions");
applyIdTransform(moderationActionSchema);

export type ModerationActionDocument = mongoose.InferSchemaType<
	typeof moderationActionSchema
>;

const ModerationAction =
	(mongoose.models
		.ModerationAction as mongoose.Model<ModerationActionDocument>) ||
	mongoose.model<ModerationActionDocument>(
		"ModerationAction",
		moderationActionSchema,
	);

export default ModerationAction;
