import type mongoose from "mongoose";
import { LikeTargetType } from "../../models/Enums";
import Comment from "../../models/Comment";
import Like from "../../models/Like";
import Post from "../../models/Post";

// Post and Comment share the fields we touch (likeCount); a permissive model
// type keeps this generic over both.
// biome-ignore lint/suspicious/noExplicitAny: generic over Post|Comment models
type LikeTargetModel = mongoose.Model<any>;

/**
 * Idempotent, race-safe like. The unique index (userId, targetType, targetId)
 * from Day 1 is the concurrency guard: an upsert either inserts (first time →
 * increment) or finds the existing row (no-op). A concurrent double-like that
 * loses the race throws E11000, which we swallow — so it is idempotent and
 * NEVER 500s. like_count is maintained with an atomic $inc, never COUNT(*).
 */
async function likeTarget(
	targetType: LikeTargetType,
	targetId: string,
	userId: string,
	model: LikeTargetModel,
): Promise<{ likeCount: number; liked: boolean; inserted: boolean }> {
	let inserted = false;
	try {
		const res = await Like.updateOne(
			{ userId, targetType, targetId },
			{ $setOnInsert: { userId, targetType, targetId } },
			{ upsert: true },
		);
		inserted = (res.upsertedCount ?? 0) > 0;
	} catch (error) {
		if ((error as { code?: number }).code !== 11000) throw error;
		inserted = false; // already liked (won a concurrent race elsewhere)
	}

	if (inserted) {
		await model.updateOne({ _id: targetId }, { $inc: { likeCount: 1 } });
	}
	// `inserted` distinguishes a first like from a repeat of one already held.
	// Callers use it to notify exactly once — re-liking must not ping the
	// author again.
	return {
		likeCount: await readLikeCount(model, targetId),
		liked: true,
		inserted,
	};
}

async function unlikeTarget(
	targetType: LikeTargetType,
	targetId: string,
	userId: string,
	model: LikeTargetModel,
): Promise<{ likeCount: number; liked: boolean }> {
	const res = await Like.deleteOne({ userId, targetType, targetId });
	if ((res.deletedCount ?? 0) > 0) {
		await model.updateOne({ _id: targetId }, { $inc: { likeCount: -1 } });
	}
	return { likeCount: await readLikeCount(model, targetId), liked: false };
}

async function readLikeCount(
	model: LikeTargetModel,
	targetId: string,
): Promise<number> {
	const doc = await model
		.findById(targetId)
		.select("likeCount")
		.lean<{ likeCount?: number } | null>();
	return doc?.likeCount ?? 0;
}

export const likePost = (postId: string, userId: string) =>
	likeTarget(LikeTargetType.Post, postId, userId, Post);
export const unlikePost = (postId: string, userId: string) =>
	unlikeTarget(LikeTargetType.Post, postId, userId, Post);
export const likeComment = (commentId: string, userId: string) =>
	likeTarget(LikeTargetType.Comment, commentId, userId, Comment);
export const unlikeComment = (commentId: string, userId: string) =>
	unlikeTarget(LikeTargetType.Comment, commentId, userId, Comment);

/** Which of [targetIds] the viewer has liked — batched (no N+1). */
export async function likedTargetIds(
	targetType: LikeTargetType,
	targetIds: string[],
	userId: string | undefined,
): Promise<Set<string>> {
	if (!userId || targetIds.length === 0) return new Set();
	const rows = await Like.find({
		userId,
		targetType,
		targetId: { $in: targetIds },
	})
		.select("targetId")
		.lean<{ targetId: mongoose.Types.ObjectId }[]>();
	return new Set(rows.map((r) => String(r.targetId)));
}
