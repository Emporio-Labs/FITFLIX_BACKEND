import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

const blockSchema = new mongoose.Schema(
	{
		blockerId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		blockedId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
	},
	{ timestamps: true },
);

// One block per pair — symmetric lookup (blockerId or blockedId = userId)
blockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
blockSchema.index({ blockedId: 1 });

applyIdTransform(blockSchema);

export type BlockDocument = mongoose.InferSchemaType<typeof blockSchema>;

const Block =
	(mongoose.models.Block as mongoose.Model<BlockDocument>) ||
	mongoose.model<BlockDocument>("Block", blockSchema);

export default Block;
