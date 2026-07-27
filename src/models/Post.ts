import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { CommunityRole, PostStatus, PostVisibility } from "./Enums";

const postSchema = new mongoose.Schema(
	{
		authorId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		content: { type: String, default: "" },
		// Community role of the author at post time (insider | trainer | admin),
		// snapshotted so the feed can render Trainer/Admin badges and resolve the
		// author's name from the correct collection without a per-request guess.
		authorRole: { type: String, default: CommunityRole.Insider },
		visibility: {
			type: String,
			enum: Object.values(PostVisibility),
			default: PostVisibility.Public,
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(PostStatus),
			default: PostStatus.Draft,
			required: true,
		},
		isOfficial: { type: Boolean, default: false },
		// Set on the first content edit; drives the public `edited` response flag.
		editedAt: { type: Date, default: null },
		pinnedAt: { type: Date, default: null },
		scheduledAt: { type: Date, default: null },
		// Self-reference: a repost points at the post it re-shares. NULL for originals.
		repostOfId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			default: null,
		},
		// Soft delete only — posts are NEVER hard deleted.
		deletedAt: { type: Date, default: null },
		// Denormalized counters (maintained by the app, not authoritative).
		likeCount: { type: Number, default: 0, min: 0 },
		commentCount: { type: Number, default: 0, min: 0 },
		shareCount: { type: Number, default: 0, min: 0 },
		repostCount: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

// Feed pagination: newest-first, tie-broken by id.
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ authorId: 1 });
postSchema.index({ deletedAt: 1 });

applyIdTransform(postSchema);

export type PostDocument = mongoose.InferSchemaType<typeof postSchema>;

const Post =
	(mongoose.models.Post as mongoose.Model<PostDocument>) ||
	mongoose.model<PostDocument>("Post", postSchema);

export default Post;
