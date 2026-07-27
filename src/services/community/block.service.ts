import mongoose from "mongoose";
import Admin from "../../models/Admin";
import Block from "../../models/Block";
import User from "../../models/User";

export type BlockResult = "ok" | "self" | "admin" | "invalid";

/**
 * Every user id whose content must be hidden from [userId]'s reads. SYMMETRIC:
 * people [userId] blocked AND people who blocked [userId] — neither party sees
 * the other. Fed straight into the feed/detail/comment queries (never filtered
 * in app code).
 */
export async function getBlockedUserIds(userId: string): Promise<string[]> {
	const rows = await Block.find({
		$or: [{ blockerId: userId }, { blockedId: userId }],
	})
		.select("blockerId blockedId")
		.lean<
			{ blockerId: mongoose.Types.ObjectId; blockedId: mongoose.Types.ObjectId }[]
		>();

	const ids = new Set<string>();
	for (const r of rows) {
		const blocker = String(r.blockerId);
		const blocked = String(r.blockedId);
		ids.add(blocker === userId ? blocked : blocker);
	}
	return [...ids];
}

export async function blockUser(
	blockerId: string,
	blockedId: string,
): Promise<BlockResult> {
	if (!mongoose.isValidObjectId(blockedId)) return "invalid";
	if (blockerId === blockedId) return "self";

	// Cannot block an admin.
	if (await Admin.exists({ _id: blockedId })) return "admin";

	try {
		await Block.updateOne(
			{ blockerId, blockedId },
			{ $setOnInsert: { blockerId, blockedId } },
			{ upsert: true },
		);
	} catch (error) {
		// Concurrent insert won the race — the block exists, which is all we want.
		if ((error as { code?: number }).code !== 11000) throw error;
	}
	return "ok";
}

export async function unblockUser(
	blockerId: string,
	blockedId: string,
): Promise<void> {
	await Block.deleteOne({ blockerId, blockedId });
}

export async function listBlocks(blockerId: string) {
	const rows = await Block.find({ blockerId })
		.sort({ createdAt: -1 })
		.select("blockedId createdAt")
		.lean<
			{ blockedId: mongoose.Types.ObjectId; createdAt: Date }[]
		>();

	const ids = rows.map((r) => String(r.blockedId));
	const users = await User.find({ _id: { $in: ids } })
		.select("username")
		.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>();
	const nameById = new Map(users.map((u) => [String(u._id), u.username ?? null]));

	return rows.map((r) => ({
		userId: String(r.blockedId),
		name: nameById.get(String(r.blockedId)) ?? null,
		blockedAt: r.createdAt,
	}));
}
