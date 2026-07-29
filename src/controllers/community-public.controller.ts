import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { communityConfig } from "../config/community";
import { CommunityRole, PostStatus, PostVisibility } from "../models/Enums";
import Post from "../models/Post";
import Trainer from "../models/Trainer";
import { decodeCursor } from "../services/community/cursor";
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

		const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const docs = await Post.find({
			deletedAt: null,
			status: PostStatus.Published,
			visibility: PostVisibility.Public,
			content: { $regex: escaped, $options: "i" },
		})
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit)
			.lean();

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
		const docs = await Post.find({
			authorId: id,
			authorRole: CommunityRole.Trainer,
			deletedAt: null,
			status: PostStatus.Published,
			visibility: PostVisibility.Public,
		})
			.sort({ createdAt: -1, _id: -1 })
			.limit(limit)
			.lean();

		res.status(200).json({
			posts: docs.map((d) => ({
				id: String(d._id),
				content: d.content,
				createdAt: d.createdAt,
				likeCount: d.likeCount ?? 0,
				commentCount: d.commentCount ?? 0,
				shareCount: d.shareCount ?? 0,
			})),
			membershipPrompt,
		});
	} catch (error) {
		next(error);
	}
};
