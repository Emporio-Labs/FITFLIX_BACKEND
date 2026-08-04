import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { PostMediaKind } from "./Enums";

const postMediaSchema = new mongoose.Schema(
	{
		postId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Post",
			required: true,
		},
		kind: {
			type: String,
			enum: Object.values(PostMediaKind),
			required: true,
		},
		url: { type: String, required: true },
		thumbnailUrl: { type: String, default: null },
		// Heavily downscaled + blurred variant. This is the ONLY image reference
		// exposed to a non-member on a members_only (locked) post.
		blurredUrl: { type: String, default: null },
		// Seconds; only meaningful for video/audio.
		duration: { type: Number, default: null, min: 0 },
		// The following three are only meaningful for kind "file" (PDF, DOCX,
		// …). A file attachment has no visual preview, so clients render a chip
		// from the original name and size instead, and the stored MIME type is
		// what the signed-URL response is served as.
		originalName: { type: String, default: null },
		mimeType: { type: String, default: null },
		bytes: { type: Number, default: null, min: 0 },
		// Ordering within a post's media carousel.
		position: { type: Number, default: 0, min: 0 },
	},
	{ timestamps: true },
);

postMediaSchema.index({ postId: 1, position: 1 });

applyIdTransform(postMediaSchema);

export type PostMediaDocument = mongoose.InferSchemaType<typeof postMediaSchema>;

const PostMedia =
	(mongoose.models.PostMedia as mongoose.Model<PostMediaDocument>) ||
	mongoose.model<PostMediaDocument>("PostMedia", postMediaSchema);

export default PostMedia;
