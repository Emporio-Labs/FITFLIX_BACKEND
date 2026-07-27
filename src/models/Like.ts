import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { LikeTargetType } from "./Enums";

const likeSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		targetType: {
			type: String,
			enum: Object.values(LikeTargetType),
			required: true,
		},
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
	},
	{ timestamps: true },
);

// Duplicate-like prevention is enforced HERE, at the database, not in code.
likeSchema.index(
	{ userId: 1, targetType: 1, targetId: 1 },
	{ unique: true },
);
// Count/lookup path: all likes on a given target.
likeSchema.index({ targetType: 1, targetId: 1 });

applyIdTransform(likeSchema);

export type LikeDocument = mongoose.InferSchemaType<typeof likeSchema>;

const Like =
	(mongoose.models.Like as mongoose.Model<LikeDocument>) ||
	mongoose.model<LikeDocument>("Like", likeSchema);

export default Like;
