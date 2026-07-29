import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const shareSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		// Optional note/caption added when sharing
		note: { type: String, default: "" },
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
