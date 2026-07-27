import mongoose from "mongoose";
import { communityConfig } from "../../config/community";
import Admin from "../../models/Admin";
import {
	CommunityRole,
	LikeTargetType,
	PostMediaKind,
	PostStatus,
	PostVisibility,
} from "../../models/Enums";
import Post from "../../models/Post";
import PostMedia from "../../models/PostMedia";
import PostVersion from "../../models/PostVersion";
import Trainer from "../../models/Trainer";
import User from "../../models/User";
import { generateSignedUrl } from "../../utils/s3.service";
import { withOptionalTransaction } from "../../utils/transaction";
import { getBlockedUserIds } from "./block.service";
import { type FeedCursor, encodeCursor } from "./cursor";
import { likedTargetIds } from "./like.service";

/** Thrown when a post disappears mid-transaction. */
export class PostNotFoundError extends Error {
	status = 404;
	code = "NOT_FOUND";
	constructor() {
		super("Post not found");
		this.name = "PostNotFoundError";
	}
}

export interface ImageRef {
	url: string;
	thumbnailUrl?: string;
	blurredUrl?: string;
	position?: number;
}

interface LeanPost {
	_id: mongoose.Types.ObjectId;
	authorId: mongoose.Types.ObjectId;
	authorRole?: string;
	content?: string;
	visibility: string;
	status: string;
	isOfficial?: boolean;
	editedAt?: Date | null;
	pinnedAt?: Date | null;
	deletedAt?: Date | null;
	likeCount?: number;
	commentCount?: number;
	shareCount?: number;
	repostCount?: number;
	createdAt: Date;
	updatedAt: Date;
}

interface LeanMedia {
	_id: mongoose.Types.ObjectId;
	postId: mongoose.Types.ObjectId;
	kind: string;
	url: string;
	thumbnailUrl?: string | null;
	blurredUrl?: string | null;
	position?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Feed filter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the Mongo filter for the feed. Deleted and non-published posts are
 * always excluded. members_only posts ARE returned to everyone; a non-member
 * receives them as a redacted stub (see buildPostResponse) — the premium
 * CONTENT never reaches a non-member, only the locked teaser does.
 */
export function buildFeedFilter(
	cursor?: FeedCursor | null,
	blockedIds?: string[],
): Record<string, unknown> {
	const filter: Record<string, unknown> = {
		deletedAt: null,
		status: PostStatus.Published,
	};

	// Block filter runs IN THE QUERY: posts by anyone the viewer blocked (or who
	// blocked the viewer) never leave the database.
	if (blockedIds && blockedIds.length > 0) {
		filter.authorId = { $nin: blockedIds };
	}

	if (cursor) {
		const at = new Date(cursor.createdAt);
		const id = new mongoose.Types.ObjectId(cursor.id);
		// Keyset pagination on (createdAt DESC, _id DESC).
		filter.$or = [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: id } },
		];
	}

	return filter;
}

// ────────────────────────────────────────────────────────────────────────────
// Response shaping (eager-loaded author + media; no N+1)
// ────────────────────────────────────────────────────────────────────────────

type PostAuthor = {
	id: string;
	name: string | null;
	role: "member" | "trainer" | "admin";
};

/** Trim + truncate to `max` chars for a locked-post teaser (never the full body). */
function excerpt(text: string, max: number): string {
	const clean = text.trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max).trimEnd()}…`;
}

async function signMedia(media: LeanMedia[]) {
	return Promise.all(
		media.map(async (m) => ({
			id: String(m._id),
			kind: m.kind,
			url: await generateSignedUrl(m.url, 900, "image/jpeg"),
			thumbnailUrl: m.thumbnailUrl
				? await generateSignedUrl(m.thumbnailUrl, 900, "image/jpeg")
				: null,
			position: m.position ?? 0,
		})),
	);
}

/**
 * Resolve each distinct author to { id, name, role } using the role snapshotted
 * on the post — trainer/admin names live in their own collections. Batched: at
 * most one query per collection.
 */
async function resolveAuthors(posts: LeanPost[]) {
	const roleById = new Map<string, PostAuthor["role"]>();
	const adminIds: string[] = [];
	const trainerIds: string[] = [];
	const memberIds: string[] = [];

	for (const p of posts) {
		const id = String(p.authorId);
		if (roleById.has(id)) continue;
		if (p.authorRole === CommunityRole.Admin) {
			roleById.set(id, "admin");
			adminIds.push(id);
		} else if (p.authorRole === CommunityRole.Trainer) {
			roleById.set(id, "trainer");
			trainerIds.push(id);
		} else {
			roleById.set(id, "member");
			memberIds.push(id);
		}
	}

	const [users, trainers, admins] = await Promise.all([
		memberIds.length
			? User.find({ _id: { $in: memberIds } })
					.select("username")
					.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>()
			: [],
		trainerIds.length
			? Trainer.find({ _id: { $in: trainerIds } })
					.select("trainerName")
					.lean<{ _id: mongoose.Types.ObjectId; trainerName?: string }[]>()
			: [],
		adminIds.length
			? Admin.find({ _id: { $in: adminIds } })
					.select("adminName")
					.lean<{ _id: mongoose.Types.ObjectId; adminName?: string }[]>()
			: [],
	]);

	const authorMap = new Map<string, PostAuthor>();
	for (const u of users)
		authorMap.set(String(u._id), {
			id: String(u._id),
			name: u.username ?? null,
			role: "member",
		});
	for (const t of trainers)
		authorMap.set(String(t._id), {
			id: String(t._id),
			name: t.trainerName ?? null,
			role: "trainer",
		});
	for (const a of admins)
		authorMap.set(String(a._id), {
			id: String(a._id),
			name: a.adminName ?? null,
			role: "admin",
		});

	return { authorMap, roleById };
}

function authorFor(
	post: LeanPost,
	resolved: Awaited<ReturnType<typeof resolveAuthors>>,
): PostAuthor {
	const id = String(post.authorId);
	return (
		resolved.authorMap.get(id) ?? {
			id,
			name: null,
			role: resolved.roleById.get(id) ?? "member",
		}
	);
}

async function buildPostResponse(
	post: LeanPost,
	author: PostAuthor,
	media: LeanMedia[],
	viewerIsMember: boolean,
	likedByViewer: boolean,
) {
	// Non-members receive members_only posts as REDACTED STUBS — no body, no
	// full media URL, only a blurred thumbnail + short teaser.
	const locked =
		!viewerIsMember && post.visibility === PostVisibility.MembersOnly;

	if (locked) {
		const first = media[0];
		return {
			id: String(post._id),
			authorId: String(post.authorId),
			author,
			visibility: post.visibility,
			createdAt: post.createdAt,
			titleOrExcerpt: excerpt(post.content ?? "", 80),
			blurredThumbnailUrl: first?.blurredUrl
				? await generateSignedUrl(first.blurredUrl, 900, "image/jpeg")
				: null,
			likeCount: post.likeCount ?? 0,
			commentCount: post.commentCount ?? 0,
			shareCount: post.shareCount ?? 0,
			edited: Boolean(post.editedAt),
			locked: true,
		};
	}

	return {
		id: String(post._id),
		authorId: String(post.authorId),
		author,
		content: post.content ?? "",
		visibility: post.visibility,
		status: post.status,
		isOfficial: Boolean(post.isOfficial),
		edited: Boolean(post.editedAt),
		pinnedAt: post.pinnedAt ?? null,
		createdAt: post.createdAt,
		updatedAt: post.updatedAt,
		likeCount: post.likeCount ?? 0,
		commentCount: post.commentCount ?? 0,
		shareCount: post.shareCount ?? 0,
		repostCount: post.repostCount ?? 0,
		likedByViewer,
		media: await signMedia(media),
		locked: false,
	};
}

/** Eager-load authors + media + viewer-like state for a page of posts (no N+1). */
async function attachAll(
	posts: LeanPost[],
	viewerIsMember: boolean,
	viewerId?: string,
) {
	if (posts.length === 0) {
		return [];
	}

	const postIds = posts.map((p) => p._id);
	const [resolved, media, likedSet] = await Promise.all([
		resolveAuthors(posts),
		PostMedia.find({ postId: { $in: postIds } })
			.sort({ position: 1 })
			.lean<LeanMedia[]>(),
		likedTargetIds(LikeTargetType.Post, postIds.map(String), viewerId),
	]);

	const mediaByPost = new Map<string, LeanMedia[]>();
	for (const m of media) {
		const key = String(m.postId);
		const list = mediaByPost.get(key);
		if (list) {
			list.push(m);
		} else {
			mediaByPost.set(key, [m]);
		}
	}

	return Promise.all(
		posts.map((p) =>
			buildPostResponse(
				p,
				authorFor(p, resolved),
				mediaByPost.get(String(p._id)) ?? [],
				viewerIsMember,
				likedSet.has(String(p._id)),
			),
		),
	);
}

/** Non-gated load of a single post response (for owners after create/edit). */
async function loadPostResponse(
	postId: string,
	opts: { includeDeleted?: boolean } = {},
	viewerId?: string,
) {
	const filter: Record<string, unknown> = { _id: postId };
	if (!opts.includeDeleted) {
		filter.deletedAt = null;
	}
	const post = await Post.findOne(filter).lean<LeanPost | null>();
	if (!post) {
		return null;
	}
	// Owner-facing load (after create/edit) — never redacted.
	const [built] = await attachAll([post], true, viewerId);
	return built ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────────────────

/**
 * Single post by id. A non-member hitting a members_only post gets the redacted
 * stub (locked: true), NOT a 404 and NOT the full content. Deleted / unpublished
 * / missing → null (→ 404).
 */
export async function getPostForViewer(
	postId: string,
	viewerIsMember: boolean,
	viewerId?: string,
) {
	const blocked = viewerId ? await getBlockedUserIds(viewerId) : [];
	const filter: Record<string, unknown> = {
		_id: postId,
		deletedAt: null,
		status: PostStatus.Published,
	};
	// A blocked author's post is invisible to the viewer (→ 404), not a stub.
	if (blocked.length > 0) filter.authorId = { $nin: blocked };

	const post = await Post.findOne(filter).lean<LeanPost | null>();
	if (!post) {
		return null;
	}
	const [built] = await attachAll([post], viewerIsMember, viewerId);
	return built ?? null;
}

export async function getFeed(
	viewerIsMember: boolean,
	params: { cursor?: FeedCursor | null; limit?: number },
	viewerId?: string,
) {
	const pageSize = params.limit ?? communityConfig.feed.defaultPageSize;
	const blocked = viewerId ? await getBlockedUserIds(viewerId) : [];
	const filter = buildFeedFilter(params.cursor, blocked);

	// Fetch one extra to know whether another page exists (no empty trailing page).
	const docs = await Post.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(pageSize + 1)
		.lean<LeanPost[]>();

	const hasMore = docs.length > pageSize;
	const page = hasMore ? docs.slice(0, pageSize) : docs;
	const posts = await attachAll(page, viewerIsMember, viewerId);

	const last = page[page.length - 1];
	const nextCursor =
		hasMore && last
			? encodeCursor({
					createdAt: new Date(last.createdAt).toISOString(),
					id: String(last._id),
				})
			: null;

	return { posts, nextCursor };
}

export interface PostMeta {
	authorId: string;
	visibility: string;
	deletedAt: Date | null;
}

/** Minimal post metadata for policy checks (ignores the visibility gate). */
export async function getPostMeta(postId: string): Promise<PostMeta | null> {
	const post = await Post.findById(postId)
		.select("authorId visibility deletedAt")
		.lean<{
			authorId: mongoose.Types.ObjectId;
			visibility: string;
			deletedAt?: Date | null;
		} | null>();
	if (!post) {
		return null;
	}
	return {
		authorId: String(post.authorId),
		visibility: post.visibility,
		deletedAt: post.deletedAt ?? null,
	};
}

export async function getVersions(postId: string) {
	const versions = await PostVersion.find({ postId })
		.sort({ editedAt: 1, createdAt: 1 })
		.lean<
			{
				_id: mongoose.Types.ObjectId;
				editedBy: mongoose.Types.ObjectId;
				editedAt: Date;
				contentSnapshot?: string;
				mediaSnapshot?: unknown;
			}[]
		>();

	return versions.map((v, index) => ({
		id: String(v._id),
		version: index + 1,
		editedBy: String(v.editedBy),
		editedAt: v.editedAt,
		contentSnapshot: v.contentSnapshot ?? "",
		mediaSnapshot: v.mediaSnapshot ?? [],
	}));
}

// ────────────────────────────────────────────────────────────────────────────
// Writes (create / edit / delete / restore) — versioned + transactional
// ────────────────────────────────────────────────────────────────────────────

export async function createPost(
	params: {
		authorId: string;
		authorRole: string;
		body: string;
		visibility: string;
		images: ImageRef[];
	},
	actingUserId: string,
) {
	const created = await withOptionalTransaction(async (session) => {
		const opts: { session?: mongoose.ClientSession } = session
			? { session }
			: {};

		const post = new Post({
			authorId: params.authorId,
			authorRole: params.authorRole,
			content: params.body,
			visibility: params.visibility,
			status: PostStatus.Published,
		});
		await post.save(opts);

		if (params.images.length > 0) {
			await PostMedia.insertMany(
				params.images.map((img, i) => ({
					postId: post._id,
					kind: PostMediaKind.Image,
					url: img.url,
					thumbnailUrl: img.thumbnailUrl ?? null,
					blurredUrl: img.blurredUrl ?? null,
					position: img.position ?? i,
				})),
				opts,
			);
		}

		// Version 1 — written in the SAME transaction as the post.
		const version = new PostVersion({
			postId: post._id,
			editedBy: actingUserId,
			contentSnapshot: params.body,
			mediaSnapshot: params.images,
		});
		await version.save(opts);

		return post;
	});

	return loadPostResponse(String(created._id), {}, actingUserId);
}

export async function editPost(
	postId: string,
	actingUserId: string,
	updates: { body?: string; visibility?: string; images?: ImageRef[] },
) {
	const current = await Post.findOne({ _id: postId, deletedAt: null }).lean<
		LeanPost | null
	>();
	if (!current) {
		return null;
	}

	const updated = await withOptionalTransaction(async (session) => {
		const opts: { session?: mongoose.ClientSession } = session
			? { session }
			: {};

		const newContent =
			updates.body !== undefined ? updates.body : (current.content ?? "");

		let mediaSnapshot: ImageRef[];
		if (updates.images !== undefined) {
			mediaSnapshot = updates.images;
		} else {
			const existing = await PostMedia.find({ postId })
				.sort({ position: 1 })
				.lean<LeanMedia[]>();
			mediaSnapshot = existing.map((m) => ({
				url: m.url,
				thumbnailUrl: m.thumbnailUrl ?? undefined,
				blurredUrl: m.blurredUrl ?? undefined,
				position: m.position,
			}));
		}

		// VERSION FIRST — so a failing post update below rolls this row back.
		const version = new PostVersion({
			postId,
			editedBy: actingUserId,
			contentSnapshot: newContent,
			mediaSnapshot,
		});
		await version.save(opts);

		const set: Record<string, unknown> = { editedAt: new Date() };
		if (updates.body !== undefined) {
			set.content = updates.body;
		}
		if (updates.visibility !== undefined) {
			set.visibility = updates.visibility;
		}

		// runValidators so an invalid value throws → aborts the txn → version rolls back.
		const doc = await Post.findOneAndUpdate(
			{ _id: postId, deletedAt: null },
			{ $set: set },
			{
				returnDocument: "after",
				runValidators: true,
				...(session ? { session } : {}),
			},
		);
		if (!doc) {
			throw new PostNotFoundError();
		}

		if (updates.images !== undefined) {
			await PostMedia.deleteMany({ postId }, opts);
			if (updates.images.length > 0) {
				await PostMedia.insertMany(
					updates.images.map((img, i) => ({
						postId,
						kind: PostMediaKind.Image,
						url: img.url,
						thumbnailUrl: img.thumbnailUrl ?? null,
						blurredUrl: img.blurredUrl ?? null,
						position: img.position ?? i,
					})),
					opts,
				);
			}
		}

		return doc;
	});

	return loadPostResponse(String(updated._id), {}, actingUserId);
}

/** Soft delete. Returns null when the post is missing or already deleted. */
export async function softDeletePost(postId: string) {
	const doc = await Post.findOneAndUpdate(
		{ _id: postId, deletedAt: null },
		{ $set: { deletedAt: new Date() } },
		{ returnDocument: "after" },
	).lean<LeanPost | null>();
	return doc ? { id: String(doc._id), deletedAt: doc.deletedAt ?? null } : null;
}

export type RestoreResult =
	| { status: "not_found" }
	| { status: "window_expired"; deletedAt: Date }
	| { status: "ok"; post: Awaited<ReturnType<typeof loadPostResponse>> };

export async function restorePost(postId: string): Promise<RestoreResult> {
	const post = await Post.findOne({
		_id: postId,
		deletedAt: { $ne: null },
	}).lean<LeanPost | null>();

	if (!post || !post.deletedAt) {
		return { status: "not_found" };
	}

	const windowMs = communityConfig.restoreWindowDays * 24 * 60 * 60 * 1000;
	if (Date.now() - post.deletedAt.getTime() > windowMs) {
		return { status: "window_expired", deletedAt: post.deletedAt };
	}

	await Post.updateOne({ _id: postId }, { $set: { deletedAt: null } });
	return { status: "ok", post: await loadPostResponse(postId) };
}
