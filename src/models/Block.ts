import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const blockSchema = new mongoose.Schema(
	{
		blockerId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		blockedId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
	},
	{ timestamps: true },
);

// One block row per (blocker, blocked) pair. The unique compound index also
// serves blockerId-prefixed lookups; blockedId is indexed separately so the
// symmetric check (blockerId OR blockedId = userId) stays covered.
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1 });

applyIdTransform(blockSchema);

export type BlockDocument = mongoose.InferSchemaType<typeof blockSchema>;

const Block =
	(mongoose.models.Block as mongoose.Model<BlockDocument>) ||
	mongoose.model<BlockDocument>("Block", blockSchema);

export default Block;
