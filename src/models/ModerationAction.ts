import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ModerationActionType, ModerationTargetType } from "./Enums";

const moderationActionSchema = new mongoose.Schema(
	{
		adminId: {
			type: mongoose.Schema.Types.ObjectId,
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
		metadata: { type: mongoose.Schema.Types.Mixed, default: null },
	},
	{ timestamps: true },
);

moderationActionSchema.index({ adminId: 1, createdAt: -1 });
moderationActionSchema.index({ targetType: 1, targetId: 1 });
moderationActionSchema.index({ action: 1 });

applyIdTransform(moderationActionSchema);

export type ModerationActionDocument = mongoose.InferSchemaType<
	typeof moderationActionSchema
>;

const ModerationAction =
	(mongoose.models.ModerationAction as mongoose.Model<ModerationActionDocument>) ||
	mongoose.model<ModerationActionDocument>(
		"ModerationAction",
		moderationActionSchema,
	);

export default ModerationAction;
