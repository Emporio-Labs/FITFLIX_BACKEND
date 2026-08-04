import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { communityConfig } from "../config/community";
import { CommunityRole, PostStatus, PostVisibility } from "../models/Enums";
import Post from "../models/Post";
import Trainer from "../models/Trainer";
import { decodeCursor, encodeCursor } from "../services/community/cursor";
import { getFeed, getPostForViewer } from "../services/community/post.service";

const NOT_FOUND = { error: "Not found", code: "NOT_FOUND" };

const membershipPrompt = {
	title: "Unlock the full Fitflix community",
	body: "Members get exclusive workout plans, nutrition guides, and trainer feedback.",
	cta: "Apply for membership",
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const parseLimit = (raw: unknown): number => {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) {
		return communityConfig.feed.defaultPageSize;
	}
	return Math.min(Math.floor(n), communityConfig.feed.maxPageSize);
};

/**
 * Keyset predicate for a (createdAt DESC, _id DESC) listing, or null when this
 * is the first page. Shared so search and a trainer's posts paginate exactly
 * like the feed does — both previously returned one capped page and silently
 * hid everything past it.
 */
const cursorFilter = (raw: unknown): Record<string, unknown> | null => {
	const cursor = typeof raw === "string" ? decodeCursor(raw) : null;
	if (!cursor || !mongoose.Types.ObjectId.isValid(cursor.id)) return null;
	const at = new Date(cursor.createdAt);
	const id = new mongoose.Types.ObjectId(cursor.id);
	return {
		$or: [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }],
	};
};

/** Encode the cursor for the next page, or null when this page is the last. */
const nextCursorFor = (
	docs: { _id: unknown; createdAt: Date }[],
	hasMore: boolean,
): string | null => {
	const last = docs[docs.length - 1];
	if (!hasMore || !last) return null;
	return encodeCursor({
		createdAt: new Date(last.createdAt).toISOString(),
		id: String(last._id),
	});
};

/** Outsider-facing feed. Members-only posts come through as redacted stubs. */
export const publicFeedHandler: RequestHandler = async (req, res, next) => {
	try {
		const cursorRaw = req.query.cursor;
		const cursor =
			typeof cursorRaw === "string" ? decodeCursor(cursorRaw) : null;
		const limit = parseLimit(req.query.limit);

		const { posts, nextCursor } = await getFeed(false, { cursor, limit });

		res.status(200).json({ posts, nextCursor, membershipPrompt });
	} catch (error) {
		next(error);
	}
};

export const publicPostDetailHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const post = await getPostForViewer(id, false);
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json({ post, membershipPrompt });
	} catch (error) {
		next(error);
	}
};

export const publicShareLinkHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const post = await Post.findOne({
			_id: id,
			deletedAt: null,
			status: PostStatus.Published,
			visibility: PostVisibility.Public,
		})
			.select("_id")
			.lean();
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const url = `${communityConfig.publicBaseUrl}/community/p/${id}`;
		res.status(200).json({ url });
	} catch (error) {
		next(error);
	}
};

/**
 * Keyword search over public posts. Uses a case-insensitive regex on content
 * so no text-index migration is required for this first cut; add a $text index
 * if the corpus grows.
 */
export const publicPostSearchHandler: RequestHandler = async (req, res, next) => {
	try {
		const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
		const limit = parseLimit(req.query.limit);

		if (!q) {
			const { posts, nextCursor } = await getFeed(false, { limit });
			res.status(200).json({ posts, nextCursor, membershipPrompt });
			return;
		}

		const base = {
			deletedAt: null,
			status: PostStatus.Published,
			visibility: PostVisibility.Public,
			// One extra row tells us whether another page exists, with no count().
			...(cursorFilter(req.query.cursor) ?? {}),
		};

		// Two passes, because neither strategy alone is right.
		//
		// $text rides the index and is the only thing that stays fast as the
		// collection grows, but it matches whole stemmed words — a searcher who
		// has typed "sath" so far matches nothing, which reads as "no results"
		// rather than "keep typing". So an empty text hit falls back to the
		// substring scan, which is correct but unindexed. The scan is bounded by
		// the page limit and only runs for queries the index genuinely cannot
		// answer, rather than on every keystroke as before.
		let found = await Post.find({ ...base, $text: { $search: q } })
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit + 1)
			.lean();

		if (found.length === 0) {
			const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			found = await Post.find({
				...base,
				content: { $regex: escaped, $options: "i" },
			})
				.sort({ createdAt: -1, _id: -1 })
				.limit(limit + 1)
				.lean();
		}

		const hasMore = found.length > limit;
		const docs = hasMore ? found.slice(0, limit) : found;

		res.status(200).json({
			posts: docs.map((d) => ({
				id: String(d._id),
				content: d.content,
				visibility: d.visibility,
				createdAt: d.createdAt,
				likeCount: d.likeCount ?? 0,
				commentCount: d.commentCount ?? 0,
				shareCount: d.shareCount ?? 0,
			})),
			nextCursor: nextCursorFor(docs, hasMore),
			membershipPrompt,
		});
	} catch (error) {
		next(error);
	}
};

export const publicTrainerListHandler: RequestHandler = async (_req, res, next) => {
	try {
		const trainers = await Trainer.find({})
			.select("trainerName description specialities createdAt")
			.sort({ createdAt: -1 })
			.limit(100)
			.lean();
		res.status(200).json({
			trainers: trainers.map((t) => ({
				id: String(t._id),
				name: t.trainerName,
				description: t.description ?? "",
				specialities: t.specialities ?? [],
			})),
			membershipPrompt,
		});
	} catch (error) {
		next(error);
	}
};

export const publicTrainerDetailHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const t = await Trainer.findById(id)
			.select("trainerName description specialities createdAt")
			.lean();
		if (!t) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json({
			trainer: {
				id: String(t._id),
				name: t.trainerName,
				description: t.description ?? "",
				specialities: t.specialities ?? [],
			},
			membershipPrompt,
		});
	} catch (error) {
		next(error);
	}
};

export const publicTrainerPostsHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const limit = parseLimit(req.query.limit);
		const found = await Post.find({
			authorId: id,
			authorRole: CommunityRole.Trainer,
			deletedAt: null,
			status: PostStatus.Published,
			visibility: PostVisibility.Public,
			...(cursorFilter(req.query.cursor) ?? {}),
		})
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit + 1)
			.lean();

		const hasMore = found.length > limit;
		const docs = hasMore ? found.slice(0, limit) : found;

		res.status(200).json({
			posts: docs.map((d) => ({
				id: String(d._id),
				content: d.content,
				createdAt: d.createdAt,
				likeCount: d.likeCount ?? 0,
				commentCount: d.commentCount ?? 0,
				shareCount: d.shareCount ?? 0,
			})),
			nextCursor: nextCursorFor(docs, hasMore),
			membershipPrompt,
		});
	} catch (error) {
		next(error);
	}
};
