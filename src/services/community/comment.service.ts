import mongoose from "mongoose";
import { LikeTargetType } from "../../models/Enums";
import Comment from "../../models/Comment";
import Post from "../../models/Post";
import { withOptionalTransaction } from "../../utils/transaction";
import {
	authorFor,
	type CommunityAuthor,
	resolveCommunityAuthors,
} from "./author";
import { getBlockedUserIds } from "./block.service";
import { type FeedCursor, encodeCursor } from "./cursor";
import { likedTargetIds } from "./like.service";

const REPLY_PREVIEW = 3;

interface LeanComment {
	_id: mongoose.Types.ObjectId;
	postId: mongoose.Types.ObjectId;
	parentId?: mongoose.Types.ObjectId | null;
	authorId: mongoose.Types.ObjectId;
	authorRole?: string;
	body: string;
	deletedAt?: Date | null;
	likeCount?: number;
	replyCount?: number;
	createdAt: Date;
}

export interface CommentMeta {
	authorId: string;
	postId: string;
	parentId: string | null;
	deletedAt: Date | null;
}

export async function getCommentMeta(id: string): Promise<CommentMeta | null> {
	const c = await Comment.findById(id)
		.select("authorId postId parentId deletedAt")
		.lean<LeanComment | null>();
	if (!c) return null;
	return {
		authorId: String(c.authorId),
		postId: String(c.postId),
		parentId: c.parentId ? String(c.parentId) : null,
		deletedAt: c.deletedAt ?? null,
	};
}

// ── Response mapping ──────────────────────────────────────────────────────────

export interface MappedComment {
	id: string;
	postId: string;
	parentId: string | null;
	deleted: boolean;
	author: CommunityAuthor | null;
	body: string | null;
	createdAt: Date;
	likeCount: number;
	replyCount: number;
	likedByViewer: boolean;
	replies: MappedComment[];
	hasMoreReplies: boolean;
}

function mapComment(
	c: LeanComment,
	authorMap: Awaited<ReturnType<typeof resolveCommunityAuthors>>,
	likedSet: Set<string>,
	extras?: {
		replies?: MappedComment[];
		hasMoreReplies?: boolean;
	},
): MappedComment {
	const deleted = c.deletedAt != null;
	return {
		id: String(c._id),
		postId: String(c.postId),
		parentId: c.parentId ? String(c.parentId) : null,
		// A soft-deleted comment renders as a tombstone so replies don't break.
		deleted,
		author: deleted ? null : authorFor({ authorId: String(c.authorId), authorRole: c.authorRole }, authorMap),
		body: deleted ? null : c.body,
		createdAt: c.createdAt,
		likeCount: deleted ? 0 : (c.likeCount ?? 0),
		replyCount: c.replyCount ?? 0,
		likedByViewer: deleted ? false : likedSet.has(String(c._id)),
		replies: extras?.replies ?? [],
		hasMoreReplies: extras?.hasMoreReplies ?? false,
	};
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createComment(params: {
	postId: string;
	authorId: string;
	authorRole: string;
	body: string;
	parentId?: string;
}) {
	// One level of nesting: a reply to a reply attaches to the SAME top-level parent.
	let resolvedParent: string | null = null;
	if (params.parentId) {
		const parent = await Comment.findOne({
			_id: params.parentId,
			postId: params.postId,
		})
			.select("parentId")
			.lean<LeanComment | null>();
		if (!parent) return null; // invalid parent for this post
		resolvedParent = parent.parentId
			? String(parent.parentId)
			: String(parent._id);
	}

	const created = await withOptionalTransaction(async (session) => {
		const opts: { session?: mongoose.ClientSession } = session ? { session } : {};
		const comment = new Comment({
			postId: params.postId,
			parentId: resolvedParent,
			authorId: params.authorId,
			authorRole: params.authorRole,
			body: params.body,
		});
		await comment.save(opts);
		await Post.updateOne(
			{ _id: params.postId },
			{ $inc: { commentCount: 1 } },
			opts,
		);
		if (resolvedParent) {
			await Comment.updateOne(
				{ _id: resolvedParent },
				{ $inc: { replyCount: 1 } },
				opts,
			);
		}
		return comment;
	});

	const lean: LeanComment = {
		_id: created._id as mongoose.Types.ObjectId,
		postId: created.postId as mongoose.Types.ObjectId,
		parentId: resolvedParent
			? new mongoose.Types.ObjectId(resolvedParent)
			: null,
		authorId: created.authorId as mongoose.Types.ObjectId,
		authorRole: params.authorRole,
		body: params.body,
		deletedAt: null,
		likeCount: 0,
		replyCount: 0,
		createdAt: (created as unknown as { createdAt: Date }).createdAt,
	};
	const authorMap = await resolveCommunityAuthors([
		{ authorId: params.authorId, authorRole: params.authorRole },
	]);
	return mapComment(lean, authorMap, new Set());
}

export async function editComment(id: string, body: string) {
	const updated = await Comment.findOneAndUpdate(
		{ _id: id, deletedAt: null },
		{ $set: { body } },
		{ returnDocument: "after", runValidators: true },
	).lean<LeanComment | null>();
	if (!updated) return null;
	const authorMap = await resolveCommunityAuthors([
		{ authorId: String(updated.authorId), authorRole: updated.authorRole },
	]);
	return mapComment(updated, authorMap, new Set());
}

export async function deleteComment(id: string): Promise<boolean> {
	const c = await Comment.findOne({ _id: id, deletedAt: null })
		.select("postId parentId")
		.lean<LeanComment | null>();
	if (!c) return false;

	await withOptionalTransaction(async (session) => {
		const opts: { session?: mongoose.ClientSession } = session ? { session } : {};
		await Comment.updateOne(
			{ _id: id },
			{ $set: { deletedAt: new Date() } },
			opts,
		);
		await Post.updateOne({ _id: c.postId }, { $inc: { commentCount: -1 } }, opts);
		if (c.parentId) {
			await Comment.updateOne(
				{ _id: c.parentId },
				{ $inc: { replyCount: -1 } },
				opts,
			);
		}
	});
	return true;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Replies of a single top-level comment (chronological, cursor-paginated). */
export async function listReplies(
	postId: string,
	parentId: string,
	viewerId: string,
	params: { cursor?: FeedCursor | null; limit: number },
) {
	const blocked = await getBlockedUserIds(viewerId);
	const filter: Record<string, unknown> = {
		postId,
		parentId,
		deletedAt: null,
	};
	if (blocked.length) filter.authorId = { $nin: blocked };
	if (params.cursor) {
		const at = new Date(params.cursor.createdAt);
		const id = new mongoose.Types.ObjectId(params.cursor.id);
		filter.$or = [
			{ createdAt: { $gt: at } },
			{ createdAt: at, _id: { $gt: id } },
		];
	}

	const docs = await Comment.find(filter)
		.sort({ createdAt: 1, _id: 1 })
		.limit(params.limit + 1)
		.lean<LeanComment[]>();
	const hasMore = docs.length > params.limit;
	const page = hasMore ? docs.slice(0, params.limit) : docs;

	const authorMap = await resolveCommunityAuthors(
		page.map((c) => ({ authorId: String(c.authorId), authorRole: c.authorRole })),
	);
	const likedSet = await likedTargetIds(
		LikeTargetType.Comment,
		page.map((c) => String(c._id)),
		viewerId,
	);
	const last = page[page.length - 1];
	return {
		comments: page.map((c) => mapComment(c, authorMap, likedSet)),
		nextCursor:
			hasMore && last
				? encodeCursor({
						createdAt: new Date(last.createdAt).toISOString(),
						id: String(last._id),
					})
				: null,
	};
}

/** Top-level comments (newest-first) with the first few replies inlined. */
export async function listComments(
	postId: string,
	viewerId: string,
	params: { cursor?: FeedCursor | null; limit: number },
) {
	const blocked = await getBlockedUserIds(viewerId);
	const filter: Record<string, unknown> = { postId, parentId: null };
	if (blocked.length) filter.authorId = { $nin: blocked };
	if (params.cursor) {
		const at = new Date(params.cursor.createdAt);
		const id = new mongoose.Types.ObjectId(params.cursor.id);
		filter.$or = [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: id } },
		];
	}

	const docs = await Comment.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(params.limit + 1)
		.lean<LeanComment[]>();
	const hasMore = docs.length > params.limit;
	const page = hasMore ? docs.slice(0, params.limit) : docs;

	// Visible replies (non-deleted, non-blocked) for this page's top-level comments.
	const topIds = page.map((c) => c._id);
	const replyFilter: Record<string, unknown> = {
		parentId: { $in: topIds },
		deletedAt: null,
	};
	if (blocked.length) replyFilter.authorId = { $nin: blocked };
	const replies = await Comment.find(replyFilter)
		.sort({ createdAt: 1, _id: 1 })
		.lean<LeanComment[]>();

	const repliesByParent = new Map<string, LeanComment[]>();
	for (const r of replies) {
		const key = String(r.parentId);
		const list = repliesByParent.get(key);
		if (list) list.push(r);
		else repliesByParent.set(key, [r]);
	}

	// A deleted top-level comment stays ONLY if it still has visible replies
	// (renders as a tombstone); otherwise it drops out.
	const visible = page.filter(
		(c) =>
			c.deletedAt == null ||
			(repliesByParent.get(String(c._id))?.length ?? 0) > 0,
	);

	// Eager-load authors + liked state across all shown comments + replies.
	const shownReplies = visible.flatMap(
		(c) => (repliesByParent.get(String(c._id)) ?? []).slice(0, REPLY_PREVIEW),
	);
	const authorMap = await resolveCommunityAuthors(
		[...visible, ...shownReplies].map((c) => ({
			authorId: String(c.authorId),
			authorRole: c.authorRole,
		})),
	);
	const likedSet = await likedTargetIds(
		LikeTargetType.Comment,
		[...visible, ...shownReplies].map((c) => String(c._id)),
		viewerId,
	);

	const comments = visible.map((c) => {
		const all = repliesByParent.get(String(c._id)) ?? [];
		const preview = all.slice(0, REPLY_PREVIEW);
		return mapComment(c, authorMap, likedSet, {
			replies: preview.map((r) => mapComment(r, authorMap, likedSet)),
			hasMoreReplies: all.length > REPLY_PREVIEW,
		});
	});

	const last = page[page.length - 1];
	return {
		comments,
		nextCursor:
			hasMore && last
				? encodeCursor({
						createdAt: new Date(last.createdAt).toISOString(),
						id: String(last._id),
					})
				: null,
	};
}
