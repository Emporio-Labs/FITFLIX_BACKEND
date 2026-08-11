import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ShareChannel } from "./Enums";

const shareSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		channel: {
			type: String,
			enum: Object.values(ShareChannel),
			required: true,
		},
	},
	{ timestamps: true },
);

shareSchema.index({ postId: 1 });
shareSchema.index({ userId: 1 });

applyIdTransform(shareSchema);

export type ShareDocument = mongoose.InferSchemaType<typeof shareSchema>;

const Share =
	(mongoose.models.Share as mongoose.Model<ShareDocument>) ||
	mongoose.model<ShareDocument>("Share", shareSchema);

export default Share;
