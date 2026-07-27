import mongoose from "mongoose";
import { applyAppendOnlyGuard } from "../utils/mongoose-append-only";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * APPEND-ONLY edit history for posts. A new row is written on every edit; rows
 * are never updated or deleted. Enforced at the data-access layer by
 * {@link applyAppendOnlyGuard} (and, when applied, the restricted DB role from
 * scripts/community-setup.ts).
 */
const postVersionSchema = new mongoose.Schema(
	{
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		editedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		editedAt: { type: Date, default: Date.now, required: true },
		// Snapshot of the post's content at the moment of this edit.
		contentSnapshot: { type: String, default: "" },
		// Snapshot of the post's media array at the moment of this edit.
		mediaSnapshot: {
			type: [mongoose.Schema.Types.Mixed],
			default: [],
		},
	},
	// Append-only: keep createdAt, drop updatedAt (a row is never updated).
	{ timestamps: { createdAt: true, updatedAt: false } },
);

postVersionSchema.index({ postId: 1, editedAt: -1 });

applyAppendOnlyGuard(postVersionSchema, "post_versions");
applyIdTransform(postVersionSchema);

export type PostVersionDocument = mongoose.InferSchemaType<
	typeof postVersionSchema
>;

const PostVersion =
	(mongoose.models.PostVersion as mongoose.Model<PostVersionDocument>) ||
	mongoose.model<PostVersionDocument>("PostVersion", postVersionSchema);

export default PostVersion;
