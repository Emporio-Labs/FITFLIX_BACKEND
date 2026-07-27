import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	blockUser,
	listBlocks,
	unblockUser,
} from "../services/community/block.service";
import {
	createComment,
	deleteComment,
	editComment,
	getCommentMeta,
	listComments,
	listReplies,
} from "../services/community/comment.service";
import { decodeCursor } from "../services/community/cursor";
import {
	likeComment,
	likePost,
	unlikeComment,
	unlikePost,
} from "../services/community/like.service";
import { can } from "../services/community/policy";
import { getPostMeta } from "../services/community/post.service";
import { createReport } from "../services/community/report.service";
import { sharePost } from "../services/community/share.service";
import {
	commentsQuerySchema,
	createCommentBodySchema,
	reportBodySchema,
	shareBodySchema,
	updateCommentBodySchema,
} from "../validators/community.validator";

const NOT_FOUND = { error: "Post not found", code: "NOT_FOUND" };
const FORBIDDEN = { error: "Forbidden", code: "FORBIDDEN" };

const getIdParam = (idParam: string | string[] | undefined): string | null =>
	typeof idParam === "string" && mongoose.Types.ObjectId.isValid(idParam)
		? idParam
		: null;

/** Load a post's meta and confirm the caller may VIEW it (policy). */
async function requireViewablePost(
	req: Parameters<RequestHandler>[0],
	res: Parameters<RequestHandler>[1],
	postId: string,
) {
	const user = req.communityUser;
	if (!user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return null;
	}
	const meta = await getPostMeta(postId);
	if (!meta || meta.deletedAt) {
		res.status(404).json(NOT_FOUND);
		return null;
	}
	if (
		!can(user, "post:view", {
			authorId: meta.authorId,
			visibility: meta.visibility,
		})
	) {
		// Can't see it → can't act on it.
		res.status(403).json(FORBIDDEN);
		return null;
	}
	return meta;
}

// ── Likes ─────────────────────────────────────────────────────────────────────

export const likePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const meta = await requireViewablePost(req, res, id);
		if (!meta) return;
		if (!can(user, "post:like")) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		res.status(200).json(await likePost(id, user.id));
	} catch (error) {
		next(error);
	}
};

export const unlikePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		// Unlike is idempotent; still require the post be viewable.
		const meta = await requireViewablePost(req, res, id);
		if (!meta) return;
		res.status(200).json(await unlikePost(id, user.id));
	} catch (error) {
		next(error);
	}
};

async function commentLikeFlow(
	req: Parameters<RequestHandler>[0],
	res: Parameters<RequestHandler>[1],
	action: (commentId: string, userId: string) => Promise<unknown>,
	requireLikePolicy: boolean,
) {
	const user = req.communityUser;
	const id = getIdParam(req.params.id);
	if (!user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}
	if (!id) {
		res.status(404).json(NOT_FOUND);
		return;
	}
	const comment = await getCommentMeta(id);
	if (!comment || comment.deletedAt) {
		res.status(404).json(NOT_FOUND);
		return;
	}
	// Must be able to view the post the comment belongs to.
	const post = await requireViewablePost(req, res, comment.postId);
	if (!post) return;
	if (requireLikePolicy && !can(user, "comment:like")) {
		res.status(403).json(FORBIDDEN);
		return;
	}
	res.status(200).json(await action(id, user.id));
}

export const likeCommentHandler: RequestHandler = (req, res, next) =>
	commentLikeFlow(req, res, likeComment, true).catch(next);

export const unlikeCommentHandler: RequestHandler = (req, res, next) =>
	commentLikeFlow(req, res, unlikeComment, false).catch(next);

// ── Shares ────────────────────────────────────────────────────────────────────

export const sharePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const meta = await requireViewablePost(req, res, id);
		if (!meta) return;

		const parsed = shareBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		// members_only is NOT shareable by anyone (policy enforces public-only,
		// even for admin).
		if (
			!can(user, "post:share", {
				authorId: meta.authorId,
				visibility: meta.visibility,
			})
		) {
			res.status(403).json({
				error: "This post cannot be shared.",
				code: "NOT_SHAREABLE",
			});
			return;
		}

		res.status(200).json(await sharePost(id, user.id, parsed.data.channel));
	} catch (error) {
		next(error);
	}
};

// ── Comments ──────────────────────────────────────────────────────────────────

export const createCommentHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const meta = await requireViewablePost(req, res, id);
		if (!meta) return;
		if (!can(user, "comment:create")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const parsed = createCommentBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const comment = await createComment({
			postId: id,
			authorId: user.id,
			authorRole: user.role,
			body: parsed.data.body,
			parentId: parsed.data.parentId,
		});
		if (!comment) {
			res.status(400).json({ error: "Invalid parent comment", code: "BAD_REQUEST" });
			return;
		}
		res.status(201).json({ comment });
	} catch (error) {
		next(error);
	}
};

export const listCommentsHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const meta = await requireViewablePost(req, res, id);
		if (!meta) return;

		const parsed = commentsQuerySchema.safeParse(req.query);
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
		const limit = parsed.data.limit ?? 20;
		const parentId = getIdParam(req.query.parentId as string | undefined);

		const result = parentId
			? await listReplies(id, parentId, user.id, { cursor, limit })
			: await listComments(id, user.id, { cursor, limit });
		res.status(200).json(result);
	} catch (error) {
		next(error);
	}
};

export const editCommentHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json({ error: "Comment not found", code: "NOT_FOUND" });
			return;
		}
		const meta = await getCommentMeta(id);
		if (!meta || meta.deletedAt) {
			res.status(404).json({ error: "Comment not found", code: "NOT_FOUND" });
			return;
		}
		if (!can(user, "comment:edit", { authorId: meta.authorId, visibility: "public" })) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		const parsed = updateCommentBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}
		const comment = await editComment(id, parsed.data.body);
		if (!comment) {
			res.status(404).json({ error: "Comment not found", code: "NOT_FOUND" });
			return;
		}
		res.status(200).json({ comment });
	} catch (error) {
		next(error);
	}
};

export const deleteCommentHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const id = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!id) {
			res.status(404).json({ error: "Comment not found", code: "NOT_FOUND" });
			return;
		}
		const meta = await getCommentMeta(id);
		if (!meta || meta.deletedAt) {
			res.status(404).json({ error: "Comment not found", code: "NOT_FOUND" });
			return;
		}
		if (!can(user, "comment:delete", { authorId: meta.authorId, visibility: "public" })) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		await deleteComment(id);
		res.status(200).json({ success: true });
	} catch (error) {
		next(error);
	}
};

// ── Blocks ────────────────────────────────────────────────────────────────────

export const blockUserHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const targetId = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!can(user, "user:block")) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		if (!targetId) {
			res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
			return;
		}
		const result = await blockUser(user.id, targetId);
		switch (result) {
			case "self":
				res.status(400).json({
					error: "You cannot block yourself.",
					code: "BAD_REQUEST",
				});
				return;
			case "admin":
				res.status(403).json({
					error: "This user cannot be blocked.",
					code: "FORBIDDEN",
				});
				return;
			case "invalid":
				res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
				return;
			default:
				res.status(200).json({ success: true });
		}
	} catch (error) {
		next(error);
	}
};

export const unblockUserHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		const targetId = getIdParam(req.params.id);
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!targetId) {
			res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
			return;
		}
		await unblockUser(user.id, targetId);
		res.status(200).json({ success: true });
	} catch (error) {
		next(error);
	}
};

export const listBlocksHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		res.status(200).json({ blocks: await listBlocks(user.id) });
	} catch (error) {
		next(error);
	}
};

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		if (!can(user, "report:create")) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		const parsed = reportBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}
		const result = await createReport({
			reporterId: user.id,
			targetType: parsed.data.targetType,
			targetId: parsed.data.targetId,
			reason: parsed.data.reason,
			note: parsed.data.note,
		});
		res.status(result.created ? 201 : 200).json({
			report: { id: result.id, status: result.status },
			alreadyReported: !result.created,
		});
	} catch (error) {
		next(error);
	}
};
