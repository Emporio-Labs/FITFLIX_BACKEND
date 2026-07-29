import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const commentSchema = new mongoose.Schema(
	{
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		parentId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Comment",
			default: null,
		},
		authorId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		// Community role at comment time (insider | trainer | admin)
		authorRole: { type: String, default: "insider" },
		body: { type: String, required: true, maxlength: 2000 },
		// Soft delete
		deletedAt: { type: Date, default: null },
		// Denormalized counters
		likeCount: { type: Number, default: 0, min: 0 },
		replyCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

commentSchema.index({ postId: 1, parentId: 1, createdAt: -1 });
commentSchema.index({ authorId: 1 });
commentSchema.index({ deletedAt: 1 });

applyIdTransform(commentSchema);

export type CommentDocument = mongoose.InferSchemaType<typeof commentSchema>;

const Comment =
	(mongoose.models.Comment as mongoose.Model<CommentDocument>) ||
	mongoose.model<CommentDocument>("Comment", commentSchema);

export default Comment;
