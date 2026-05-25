import mongoose from "mongoose";

const tokenBlacklistSchema = new mongoose.Schema(
	{
		token: { type: String, required: true, unique: true, index: true },
		userId: { type: String },
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: true },
);

// Auto-delete documents when expiresAt passes (MongoDB TTL index)
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TokenBlacklist = mongoose.model("TokenBlacklist", tokenBlacklistSchema);

export default TokenBlacklist;
