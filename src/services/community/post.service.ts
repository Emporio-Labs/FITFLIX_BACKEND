import mongoose from "mongoose";
import { communityConfig } from "../../config/community";
import {
	LikeTargetType,
	PostMediaKind,
	PostStatus,
	PostVisibility,
} from "../../models/Enums";
import Post from "../../models/Post";
import PostMedia from "../../models/PostMedia";
import PostVersion from "../../models/PostVersion";
import { generateSignedUrl } from "../../utils/s3.service";
import { withOptionalTransaction } from "../../utils/transaction";
import {
	type CommunityAuthor,
	authorFor as sharedAuthorFor,
	resolveCommunityAuthors,
} from "./author";
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
	width?: number;
	height?: number;
}

export interface AudioRef {
	url: string;
	duration: number;
}

export interface VideoRef {
	s3Key: string;
}

/** A non-previewable attachment (PDF, DOCX, XLSX, TXT) already uploaded via
 *  POST /community/media/files. */
export interface FileRef {
	url: string;
	originalName?: string;
	mimeType?: string;
	bytes?: number;
	position?: number;
}

interface LeanPost {
	_id: mongoose.Types.ObjectId;
	authorId: mongoose.Types.ObjectId;
	authorRole?: string;
	title?: string;
	content?: string;
	description?: string;
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
	duration?: number | null;
	originalName?: string | null;
	mimeType?: string | null;
	bytes?: number | null;
	position?: number;
	width?: number | null;
	height?: number | null;
}

/** Infer the response Content-Type for a media object from its kind and, for
 * audio, the stored S3 key extension (the upload path assigns .mp3 / .m4a /
 * .aac deterministically per declared MIME). */
function contentTypeFor(m: LeanMedia): string {
	if (m.kind === PostMediaKind.Audio) {
		const url = m.url.toLowerCase();
		if (url.endsWith(".mp3")) return "audio/mpeg";
		if (url.endsWith(".m4a") || url.endsWith(".mp4")) return "audio/mp4";
		if (url.endsWith(".aac")) return "audio/aac";
		return "audio/mpeg";
	}
	if (m.kind === PostMediaKind.Video) {
		const url = m.url.toLowerCase();
		if (url.endsWith(".webm")) return "video/webm";
		if (url.endsWith(".mov")) return "video/quicktime";
		return "video/mp4";
	}
	// Files keep the MIME type recorded at upload time; without it the browser
	// would be told a PDF is a JPEG and refuse to open it.
	if (m.kind === PostMediaKind.File) {
		return m.mimeType || "application/octet-stream";
	}
	return "image/jpeg";
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

	// The chronological body excludes pinned posts — they are prepended to page
	// one by getFeed. Without this they would appear twice on the first page and
	// then again wherever their timestamp falls. `{ pinnedAt: null }` matches
	// documents where the field is null *or* absent, which covers every post
	// that was never pinned.
	filter.pinnedAt = null;

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

/** Re-exported shape from ./author — kept as a local alias so the many
 *  signatures below stay unchanged. */
type PostAuthor = CommunityAuthor;

/** Trim + truncate to `max` chars for a locked-post teaser (never the full body). */
function excerpt(text: string, max: number): string {
	const clean = text.trim();
	if (clean.length <= max) return clean;
	return `${clean.slice(0, max).trimEnd()}…`;
}

/**
 * Truncate the description for feed responses. Returns the preview text and a
 * flag indicating whether the full description is longer. Feed callers pass
 * `fullDescription: false`; the detail endpoint passes `true`.
 */
function descriptionPreview(
	text: string,
	max: number,
): { preview: string; hasMore: boolean } {
	const clean = text.trim();
	if (clean.length <= max) return { preview: clean, hasMore: false };
	return { preview: `${clean.slice(0, max).trimEnd()}…`, hasMore: true };
}

async function signMedia(media: LeanMedia[]) {
	return Promise.all(
		media.map(async (m) => {
			const contentType = contentTypeFor(m);
			return {
				id: String(m._id),
				kind: m.kind,
				url: await generateSignedUrl(m.url, 900, contentType),
				thumbnailUrl: m.thumbnailUrl
					? await generateSignedUrl(m.thumbnailUrl, 900, "image/jpeg")
					: null,
				duration: m.duration ?? null,
				originalName: m.originalName ?? null,
				mimeType: m.mimeType ?? null,
				bytes: m.bytes ?? null,
				position: m.position ?? 0,
				width: m.width ?? null,
				height: m.height ?? null,
			};
		}),
	);
}

/**
 * Resolve each distinct author to { id, name, role, avatarUrl } using the role
 * snapshotted on the post — trainer/admin names live in their own collections.
 * Batched: at most one query per collection.
 *
 * Delegates to the shared resolver in ./author so posts, comments and profiles
 * can never disagree about a person's name or avatar. This wrapper exists only
 * to adapt LeanPost to the shared item shape.
 */
async function resolveAuthors(posts: LeanPost[]) {
	return resolveCommunityAuthors(
		posts.map((p) => ({
			authorId: String(p.authorId),
			authorRole: p.authorRole,
		})),
	);
}

function authorFor(
	post: LeanPost,
	resolved: Awaited<ReturnType<typeof resolveAuthors>>,
): PostAuthor {
	return sharedAuthorFor(
		{ authorId: String(post.authorId), authorRole: post.authorRole },
		resolved,
	);
}

async function buildPostResponse(
	post: LeanPost,
	author: PostAuthor,
	media: LeanMedia[],
	viewerIsMember: boolean,
	likedByViewer: boolean,
	opts: { fullDescription?: boolean } = {},
) {
	// Non-members receive members_only posts as REDACTED STUBS — no body, no
	// full media URL, only a blurred thumbnail + short teaser.
	const locked =
		!viewerIsMember && post.visibility === PostVisibility.MembersOnly;

	if (locked) {
		const first = media[0];
		const titleText = (post.title ?? "").trim();
		return {
			id: String(post._id),
			authorId: String(post.authorId),
			author,
			visibility: post.visibility,
			createdAt: post.createdAt,
			titleOrExcerpt: excerpt(
				titleText.length > 0 ? titleText : (post.content ?? ""),
				80,
			),
			blurredThumbnailUrl: first?.blurredUrl
				? await generateSignedUrl(first.blurredUrl, 900, "image/jpeg")
				: null,
			likeCount: post.likeCount ?? 0,
			commentCount: post.commentCount ?? 0,
			shareCount: post.shareCount ?? 0,
			edited: Boolean(post.editedAt),
			locked: true,
			// description intentionally absent — never exposed in locked stubs.
		};
	}

	const rawDescription = post.description ?? "";
	const previewMax = communityConfig.feed.descriptionPreviewLength;
	const { preview, hasMore } = descriptionPreview(rawDescription, previewMax);

	return {
		id: String(post._id),
		authorId: String(post.authorId),
		author,
		title: post.title ?? "",
		content: post.content ?? "",
		// Detail endpoint returns the full description; feed returns a preview.
		...(opts.fullDescription
			? { description: rawDescription }
			: {
					descriptionPreview: preview,
					descriptionHasMore: hasMore,
			  }),
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
	opts: { fullDescription?: boolean } = {},
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
				opts,
			),
		),
	);
}

/** Non-gated load of a single post response (for owners after create/edit). */
async function loadPostResponse(
	postId: string,
	opts: { includeDeleted?: boolean; fullDescription?: boolean } = {},
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
	// Owner-facing load (after create/edit) — never redacted, always full description.
	const [built] = await attachAll([post], true, viewerId, { fullDescription: opts.fullDescription ?? true });
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
	// Detail endpoint — always return the full description.
	const [built] = await attachAll([post], viewerIsMember, viewerId, { fullDescription: true });
	return built ?? null;
}

/**
 * How many pinned posts may lead the feed. Pinning is for the occasional gym
 * announcement; a feed that opens with fifteen sticky posts is just a worse
 * feed, so the tail is dropped rather than pushing real content off-screen.
 */
const MAX_PINNED_IN_FEED = 3;

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

	// Pinned posts lead page one.
	//
	// Deliberately a separate query rather than a `{ pinnedAt: -1, createdAt: -1 }`
	// sort: the cursor is a keyset on (createdAt, _id), and mixing a third key
	// into the ordering would make page two's `createdAt < cursor` predicate skip
	// pinned posts that are older than the cursor. Keeping the chronological body
	// pinned-free (see buildFeedFilter) leaves that cursor exactly as it was.
	const pinnedDocs = params.cursor
		? []
		: await Post.find({
				...buildFeedFilter(null, blocked),
				pinnedAt: { $ne: null },
			})
				.sort({ pinnedAt: -1, _id: -1 })
				.limit(MAX_PINNED_IN_FEED)
				.lean<LeanPost[]>();

	const posts = await attachAll(
		[...pinnedDocs, ...page],
		viewerIsMember,
		viewerId,
	);

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

/**
 * One author's posts, newest first — the list behind a profile screen.
 *
 * Shares `attachAll` with the feed, which is the whole point: members_only
 * posts are redacted into the same `locked: true` stubs for a non-member here
 * as they are in the feed, with no second copy of the redaction logic to get
 * out of sync.
 *
 * Unlike the feed this does NOT exclude pinned posts — on a profile the
 * chronology should be complete.
 */
export async function getPostsByAuthor(
	authorId: string,
	viewerIsMember: boolean,
	params: { cursor?: FeedCursor | null; limit?: number },
	viewerId?: string,
) {
	const pageSize = params.limit ?? communityConfig.feed.defaultPageSize;

	const filter: Record<string, unknown> = {
		authorId,
		deletedAt: null,
		status: PostStatus.Published,
	};
	if (params.cursor) {
		const at = new Date(params.cursor.createdAt);
		const id = new mongoose.Types.ObjectId(params.cursor.id);
		// Keyset pagination on (createdAt DESC, _id DESC) — same shape as the feed.
		filter.$or = [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: id } },
		];
	}

	// Fetch one extra to know whether another page exists.
	const docs = await Post.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(pageSize + 1)
		.lean<LeanPost[]>();

	const hasMore = docs.length > pageSize;
	const page = hasMore ? docs.slice(0, pageSize) : docs;

	const posts = await attachAll(page, viewerIsMember, viewerId);

	const last = page[page.length - 1];
	return {
		posts,
		nextCursor:
			hasMore && last
				? encodeCursor({
						createdAt: new Date(last.createdAt).toISOString(),
						id: String(last._id),
					})
				: null,
	};
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
				titleSnapshot?: string;
				contentSnapshot?: string;
				descriptionSnapshot?: string;
				mediaSnapshot?: unknown;
			}[]
		>();

	return versions.map((v, index) => ({
		id: String(v._id),
		version: index + 1,
		editedBy: String(v.editedBy),
		editedAt: v.editedAt,
		titleSnapshot: v.titleSnapshot ?? "",
		contentSnapshot: v.contentSnapshot ?? "",
		descriptionSnapshot: v.descriptionSnapshot ?? "",
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
		title?: string;
		body: string;
		description?: string;
		visibility: string;
		images: ImageRef[];
		audio?: AudioRef[];
		video?: VideoRef;
	},
	actingUserId: string,
) {
	const audioRefs = params.audio ?? [];
	const titleValue = params.title ?? "";
	const descriptionValue = params.description ?? "";
	const created = await withOptionalTransaction(async (session) => {
		const opts: { session?: mongoose.ClientSession } = session
			? { session }
			: {};

		const post = new Post({
			authorId: params.authorId,
			authorRole: params.authorRole,
			title: titleValue,
			content: params.body,
			description: descriptionValue,
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
					width: img.width ?? null,
					height: img.height ?? null,
				})),
				opts,
			);
		}

		// Video sits after images, before audio, in the carousel order.
		if (params.video) {
			await PostMedia.create(
				[
					{
						postId: post._id,
						kind: PostMediaKind.Video,
						url: params.video.s3Key,
						position: params.images.length,
					},
				],
				opts,
			);
		}

		if (audioRefs.length > 0) {
			const base = params.images.length + (params.video ? 1 : 0);
			await PostMedia.insertMany(
				audioRefs.map((a, i) => ({
					postId: post._id,
					kind: PostMediaKind.Audio,
					url: a.url,
					duration: a.duration,
					position: base + i,
				})),
				opts,
			);
		}

		// Version 1 — written in the SAME transaction as the post.
		const version = new PostVersion({
			postId: post._id,
			editedBy: actingUserId,
			titleSnapshot: titleValue,
			contentSnapshot: params.body,
			descriptionSnapshot: descriptionValue,
			mediaSnapshot: [
				...params.images,
				...(params.video
					? [{ kind: PostMediaKind.Video, url: params.video.s3Key }]
					: []),
				...audioRefs,
			],
		});
		await version.save(opts);

		return post;
	});

	return loadPostResponse(String(created._id), {}, actingUserId);
}

export async function editPost(
	postId: string,
	actingUserId: string,
	updates: {
		title?: string;
		body?: string;
		description?: string;
		visibility?: string;
		images?: ImageRef[];
		audio?: AudioRef[];
		/** undefined = leave untouched, null = remove, object = replace. */
		video?: VideoRef | null;
	},
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
		const newTitle =
			updates.title !== undefined ? updates.title : (current.title ?? "");
		const newDescription =
			updates.description !== undefined ? updates.description : (current.description ?? "");

		let mediaSnapshot: Array<Record<string, unknown>>;
		if (
			updates.images !== undefined ||
			updates.audio !== undefined ||
			updates.video !== undefined
		) {
			const touchesAll =
				updates.images !== undefined &&
				updates.audio !== undefined &&
				updates.video !== undefined;
			const existing = touchesAll
				? []
				: await PostMedia.find({ postId })
						.sort({ position: 1 })
						.lean<LeanMedia[]>();
			const nextImages =
				updates.images ??
				existing
					.filter((m) => m.kind === PostMediaKind.Image)
					.map((m) => ({
						url: m.url,
						thumbnailUrl: m.thumbnailUrl ?? undefined,
						blurredUrl: m.blurredUrl ?? undefined,
						position: m.position,
					}));
			const nextAudio =
				updates.audio ??
				existing
					.filter((m) => m.kind === PostMediaKind.Audio)
					.map((m) => ({ url: m.url, duration: m.duration ?? 0 }));
			const nextVideo =
				updates.video !== undefined
					? updates.video
					: (existing.find((m) => m.kind === PostMediaKind.Video) ?? null);
			mediaSnapshot = [
				...nextImages.map((r) => ({ kind: PostMediaKind.Image, ...r })),
				...(nextVideo
					? [
							{
								kind: PostMediaKind.Video,
								url: "s3Key" in nextVideo ? nextVideo.s3Key : nextVideo.url,
							},
						]
					: []),
				...nextAudio.map((r) => ({ kind: PostMediaKind.Audio, ...r })),
			];
		} else {
			const existing = await PostMedia.find({ postId })
				.sort({ position: 1 })
				.lean<LeanMedia[]>();
			mediaSnapshot = existing.map((m) => ({
				kind: m.kind,
				url: m.url,
				thumbnailUrl: m.thumbnailUrl ?? undefined,
				blurredUrl: m.blurredUrl ?? undefined,
				duration: m.duration ?? undefined,
				position: m.position,
			}));
		}

		// VERSION FIRST — so a failing post update below rolls this row back.
		const version = new PostVersion({
			postId,
			editedBy: actingUserId,
			titleSnapshot: newTitle,
			contentSnapshot: newContent,
			descriptionSnapshot: newDescription,
			mediaSnapshot,
		});
		await version.save(opts);

		const set: Record<string, unknown> = { editedAt: new Date() };
		if (updates.title !== undefined) {
			set.title = updates.title;
		}
		if (updates.body !== undefined) {
			set.content = updates.body;
		}
		if (updates.description !== undefined) {
			set.description = updates.description;
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

		// Replace media per-kind so an image-only edit doesn't wipe attached audio
		// (and vice versa).
		if (updates.images !== undefined) {
			await PostMedia.deleteMany(
				{ postId, kind: PostMediaKind.Image },
				opts,
			);
			if (updates.images.length > 0) {
				await PostMedia.insertMany(
					updates.images.map((img, i) => ({
						postId,
						kind: PostMediaKind.Image,
						url: img.url,
						thumbnailUrl: img.thumbnailUrl ?? null,
						blurredUrl: img.blurredUrl ?? null,
						position: img.position ?? i,
						width: img.width ?? null,
						height: img.height ?? null,
					})),
					opts,
				);
			}
		}

		if (updates.video !== undefined) {
			await PostMedia.deleteMany(
				{ postId, kind: PostMediaKind.Video },
				opts,
			);
			if (updates.video !== null) {
				const base = (updates.images ?? []).length;
				await PostMedia.create(
					[
						{
							postId,
							kind: PostMediaKind.Video,
							url: updates.video.s3Key,
							position: base,
						},
					],
					opts,
				);
			}
		}

		if (updates.audio !== undefined) {
			await PostMedia.deleteMany(
				{ postId, kind: PostMediaKind.Audio },
				opts,
			);
			if (updates.audio.length > 0) {
				const base =
					(updates.images ?? []).length + (updates.video ? 1 : 0);
				await PostMedia.insertMany(
					updates.audio.map((a, i) => ({
						postId,
						kind: PostMediaKind.Audio,
						url: a.url,
						duration: a.duration,
						position: base + i,
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
