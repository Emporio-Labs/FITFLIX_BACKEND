import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { communityConfig } from "../config/community";
import { CommunityRole } from "../models/Enums";
import {
	ImageUploadError,
	processAndUploadImage,
} from "../services/community/image.service";
import {
	AudioUploadError,
	processAndUploadAudio,
} from "../services/community/audio.service";
import {
	presignVideoUpload,
	validateUploadedVideo,
	VideoUploadError,
} from "../services/community/video.service";
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
	videoPresignRequestSchema,
} from "../validators/community.validator";
import { generateSignedUrl, uploadToS3 } from "../utils/s3.service";

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

		// Confirm the client actually completed the presigned-PUT upload before
		// trusting the S3 key it reports.
		const video = parsed.data.video
			? await validateUploadedVideo(parsed.data.video.s3Key)
			: undefined;

		const post = await createPost(
			{
				authorId: user.id,
				authorRole: user.role,
				title: parsed.data.title,
				body: parsed.data.body,
				description: parsed.data.description,
				visibility: parsed.data.visibility,
				images: parsed.data.images,
				audio: parsed.data.audio,
				video: video ? { s3Key: video.s3Key } : undefined,
			},
			user.id,
		);

		res.status(201).json({ post });
	} catch (error) {
		if (error instanceof VideoUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
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

		// undefined = leave video untouched; null = clear it; object = replace it
		// (re-validated against S3 so a stale/forged key can't be attached).
		const video =
			parsed.data.video === undefined
				? undefined
				: parsed.data.video === null
					? null
					: await validateUploadedVideo(parsed.data.video.s3Key);

		const post = await editPost(id, user.id, {
			...parsed.data,
			video: video === undefined ? undefined : video === null ? null : { s3Key: video.s3Key },
		});
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		res.status(200).json({ post });
	} catch (error) {
		if (error instanceof VideoUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
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

/**
 * Upload one audio clip. Duration comes from the client (a hint from the
 * device-side audio decoder); the service caps it against
 * communityConfig.maxAudioDurationSeconds so an over-declared value is rejected.
 * Returns the stored S3 key + a short-lived signed preview URL.
 */
export const uploadAudioHandler: RequestHandler = async (req, res, next) => {
	const file = req.file as Express.Multer.File | undefined;
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
		if (!file) {
			res
				.status(400)
				.json({ error: "No audio provided", code: "BAD_REQUEST" });
			return;
		}

		const durationRaw = req.body?.duration ?? req.body?.durationSeconds;
		const duration = Number(durationRaw);

		const uploaded = await processAndUploadAudio(file, duration);
		const previewUrl = await generateSignedUrl(
			uploaded.url,
			900,
			uploaded.mimeType,
		);

		res.status(201).json({
			audio: {
				url: uploaded.url,
				previewUrl,
				duration: uploaded.duration,
				mimeType: uploaded.mimeType,
				bytes: uploaded.bytes,
			},
		});
	} catch (error) {
		if (error instanceof AudioUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	} finally {
		if (file) {
			await unlink(file.path).catch(() => {});
		}
	}
};

/**
 * Mint a presigned PUT URL so the client uploads a video directly to S3
 * (bypassing this server, unlike images/audio/docs which proxy through
 * uploadFilesHandler). The client PUTs the raw file to `uploadUrl`, then
 * references `s3Key` when creating/editing the post — validateUploadedVideo
 * confirms the upload actually happened before it's trusted.
 */
export const presignVideoUploadHandler: RequestHandler = async (req, res, next) => {
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

		const parsed = videoPresignRequestSchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const result = await presignVideoUpload(parsed.data);
		res.status(201).json(result);
	} catch (error) {
		if (error instanceof VideoUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	}
};

const IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

/**
 * General-purpose file upload handler.
 * Images are processed (resized/optimised) via processAndUploadImage.
 * Documents and videos are stored as-is under posts/videos/ or posts/files/.
 * Returns S3 keys + short-lived signed preview URLs.
 */
export const uploadFilesHandler: RequestHandler = async (req, res, next) => {
	const files = (req.files as Express.Multer.File[] | undefined) ?? [];
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!can(user, "post:create")) {
			res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
			return;
		}
		if (files.length === 0) {
			res.status(400).json({ error: "No files provided", code: "BAD_REQUEST" });
			return;
		}

		const results = [];
		for (const [i, file] of files.entries()) {
			const mime = file.mimetype.toLowerCase();
			if (IMAGE_MIMES.has(mime)) {
				// Reuse the existing image pipeline (resizing + variants).
				const img = await processAndUploadImage(file, i);
				results.push({
					type: "image" as const,
					url: img.url,
					thumbnailUrl: img.thumbnailUrl,
					fullUrl: img.fullUrl,
					blurredUrl: img.blurredUrl,
					position: img.position,
					width: img.width,
					height: img.height,
					bytes: img.bytes,
					originalName: file.originalname,
					mimeType: mime,
				});
			} else {
				// Documents / videos: upload directly, no processing.
				const uuid = randomUUID();
				const ext = file.originalname.includes(".")
					? file.originalname.slice(file.originalname.lastIndexOf("."))
					: "";
				const subfolder = mime.startsWith("video/") ? "videos" : "files";
				const key = `posts/${subfolder}/${uuid}${ext}`;
				const buffer = await readFile(file.path);
				await uploadToS3(key, buffer, mime);
				const previewUrl = await generateSignedUrl(key, 900, mime);
				results.push({
					type: "file" as const,
					url: key,
					previewUrl,
					bytes: file.size,
					originalName: file.originalname,
					mimeType: mime,
				});
			}
		}

		res.status(201).json({ files: results });
	} catch (error) {
		if (error instanceof ImageUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	} finally {
		await Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
	}
};

