import { unlink } from "node:fs/promises";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { communityConfig } from "../config/community";
import { CommunityRole } from "../models/Enums";
import {
	ImageUploadError,
	processAndUploadImage,
} from "../services/community/image.service";
import { can } from "../services/community/policy";
import {
	createPost,
	editPost,
	getFeed,
	getPostForViewer,
	getPostMeta,
	getVersions,
	restorePost,
	softDeletePost,
} from "../services/community/post.service";
import { decodeCursor } from "../services/community/cursor";
import {
	createPostBodySchema,
	feedQuerySchema,
	updatePostBodySchema,
} from "../validators/community.validator";

const NOT_FOUND = { error: "Post not found", code: "NOT_FOUND" };
const FORBIDDEN = { error: "Forbidden", code: "FORBIDDEN" };

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const isMember = (role: CommunityRole): boolean =>
	role !== CommunityRole.Outsider;

export const createPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!can(user, "post:create")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const parsed = createPostBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const post = await createPost(
			{
				authorId: user.id,
				authorRole: user.role,
				body: parsed.data.body,
				visibility: parsed.data.visibility,
				images: parsed.data.images,
			},
			user.id,
		);

		res.status(201).json({ post });
	} catch (error) {
		next(error);
	}
};

export const getPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		// Visibility is enforced in the query: an outsider hitting a members_only
		// id gets null → 404 (never a 403 — do not leak existence).
		const post = await getPostForViewer(id, isMember(user.role), user.id);
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		res.status(200).json({
			post,
			viewer: { role: user.role, userId: user.id },
		});
	} catch (error) {
		next(error);
	}
};

export const editPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const meta = await getPostMeta(id);
		if (!meta || meta.deletedAt) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (
			!can(user, "post:edit", {
				authorId: meta.authorId,
				visibility: meta.visibility,
			})
		) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const parsed = updatePostBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const post = await editPost(id, user.id, parsed.data);
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		res.status(200).json({ post });
	} catch (error) {
		next(error);
	}
};

export const deletePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const meta = await getPostMeta(id);
		if (!meta || meta.deletedAt) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (
			!can(user, "post:delete", {
				authorId: meta.authorId,
				visibility: meta.visibility,
			})
		) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const result = await softDeletePost(id);
		if (!result) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		res.status(200).json({ success: true, ...result });
	} catch (error) {
		next(error);
	}
};

export const restorePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const meta = await getPostMeta(id);
		if (!meta) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (
			!can(user, "post:delete", {
				authorId: meta.authorId,
				visibility: meta.visibility,
			})
		) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const result = await restorePost(id);
		if (result.status === "not_found") {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (result.status === "window_expired") {
			res.status(410).json({
				error: `This post can no longer be restored. The ${communityConfig.restoreWindowDays}-day restore window expired on ${result.deletedAt.toISOString()}.`,
				code: "RESTORE_WINDOW_EXPIRED",
			});
			return;
		}

		res.status(200).json({ post: result.post });
	} catch (error) {
		next(error);
	}
};

export const getVersionsHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const meta = await getPostMeta(id);
		if (!meta) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		// Author-only or admin (read-only). Everyone else is forbidden.
		if (
			!can(user, "history:view", {
				authorId: meta.authorId,
				visibility: meta.visibility,
			})
		) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const versions = await getVersions(id);
		res.status(200).json({ versions });
	} catch (error) {
		next(error);
	}
};

export const getFeedHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const parsed = feedQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		let cursor = null;
		if (parsed.data.cursor) {
			cursor = decodeCursor(parsed.data.cursor);
			if (!cursor || !mongoose.isValidObjectId(cursor.id)) {
				res.status(400).json({ error: "Invalid cursor", code: "BAD_REQUEST" });
				return;
			}
		}

		const result = await getFeed(
			isMember(user.role),
			{ cursor, limit: parsed.data.limit },
			user.id,
		);

		res.status(200).json({
			...result,
			viewer: { role: user.role, userId: user.id },
		});
	} catch (error) {
		next(error);
	}
};

export const uploadImagesHandler: RequestHandler = async (req, res, next) => {
	const files = (req.files as Express.Multer.File[] | undefined) ?? [];
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		// Only those who can create posts may upload images.
		if (!can(user, "post:create")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		if (files.length === 0) {
			res
				.status(400)
				.json({ error: "No images provided", code: "BAD_REQUEST" });
			return;
		}

		const images = [];
		for (const [i, file] of files.entries()) {
			images.push(await processAndUploadImage(file, i));
		}

		res.status(201).json({
			images: images.map((img) => ({
				url: img.url,
				thumbnailUrl: img.thumbnailUrl,
				fullUrl: img.fullUrl,
				blurredUrl: img.blurredUrl,
				position: img.position,
				width: img.width,
				height: img.height,
				bytes: img.bytes,
			})),
		});
	} catch (error) {
		if (error instanceof ImageUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	} finally {
		// Always clean up the multer temp files.
		await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
	}
};
