import mongoose from "mongoose";
import { CommunityRole } from "./Enums";
import { applyIdTransform } from "../utils/mongoose-serialization";

const commentSchema = new mongoose.Schema(
	{
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		// Self-reference for threaded replies. NULL for a top-level comment.
		parentId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Comment",
			default: null,
		},
		authorId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// Author's community role at comment time (member/insider | trainer |
		// admin) so the feed can render Trainer/Admin badges + resolve the name.
		authorRole: { type: String, default: CommunityRole.Insider },
		body: { type: String, required: true, maxlength: 2000 },
		// Soft delete only — comments are NEVER hard deleted.
		deletedAt: { type: Date, default: null },
		// Denormalized counters
		likeCount: { type: Number, default: 0, min: 0 },
		replyCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

commentSchema.index({ postId: 1, createdAt: 1 });
// Top-level pagination (parentId:null) and reply lookups.
commentSchema.index({ postId: 1, parentId: 1, createdAt: -1 });
commentSchema.index({ parentId: 1 });
// Moderation path: all comments by a given author.
commentSchema.index({ authorId: 1 });

applyIdTransform(commentSchema);

export type CommentDocument = mongoose.InferSchemaType<typeof commentSchema>;

const Comment =
	(mongoose.models.Comment as mongoose.Model<CommentDocument>) ||
	mongoose.model<CommentDocument>("Comment", commentSchema);

export default Comment;
