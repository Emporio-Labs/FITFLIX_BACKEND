import mongoose from "mongoose";
import Admin from "../../models/Admin";
import Block from "../../models/Block";
import User from "../../models/User";
import { type FeedCursor, encodeCursor } from "./cursor";

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

/**
 * The viewer's block list, newest first.
 *
 * Cursor-paginated like every other community listing: someone who has been
 * moderating for a year can accumulate more blocks than one response should
 * carry, and returning a silently truncated list is the worst of both.
 */
export async function listBlocks(
	blockerId: string,
	params: { cursor?: FeedCursor | null; limit?: number } = {},
) {
	const limit = params.limit ?? 50;
	const filter: Record<string, unknown> = { blockerId };
	if (params.cursor) {
		const at = new Date(params.cursor.createdAt);
		const id = new mongoose.Types.ObjectId(params.cursor.id);
		filter.$or = [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: id } },
		];
	}

	// One extra row reveals whether another page exists.
	const found = await Block.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(limit + 1)
		.select("blockedId createdAt")
		.lean<
			{ _id: mongoose.Types.ObjectId; blockedId: mongoose.Types.ObjectId; createdAt: Date }[]
		>();
	const hasMore = found.length > limit;
	const rows = hasMore ? found.slice(0, limit) : found;

	const ids = rows.map((r) => String(r.blockedId));
	const users = await User.find({ _id: { $in: ids } })
		.select("username")
		.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>();
	const nameById = new Map(users.map((u) => [String(u._id), u.username ?? null]));

	const last = rows[rows.length - 1];
	return {
		blocks: rows.map((r) => ({
			userId: String(r.blockedId),
			name: nameById.get(String(r.blockedId)) ?? null,
			blockedAt: r.createdAt,
		})),
		nextCursor:
			hasMore && last
				? encodeCursor({
						createdAt: new Date(last.createdAt).toISOString(),
						id: String(last._id),
					})
				: null,
	};
}
