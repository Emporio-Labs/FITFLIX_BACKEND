import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Admin from "../models/Admin";
import {
	adminDeleteComment,
	adminDeletePost,
	adminEditPost,
	adminRestorePost,
	assignTrainerRole,
	banUser,
	createOfficialPost,
	getPostAdmin,
	getUserModerationDetail,
	listCommentsAdmin,
	listPendingReports,
	listPostsAdmin,
	listUsersAdmin,
	pinPost,
	type ReportAction,
	resolveReport,
	revokeTrainerRole,
	suspendUser,
	unbanUser,
	unpinPost,
	unsuspendUser,
} from "../services/community/moderation.service";
import { getVersions } from "../services/community/post.service";
import {
	validateUploadedVideo,
	VideoUploadError,
} from "../services/community/video.service";
import { getJwtConfig, signStepUpToken } from "../utils/jwt";
import { verifyPassword } from "../utils/password";

const getId = (v: string | string[] | undefined): string | null =>
	typeof v === "string" && mongoose.Types.ObjectId.isValid(v) ? v : null;

const NOT_FOUND = { error: "Not found", code: "NOT_FOUND" };

/** Re-enter the admin password → short-lived step-up token for destructive ops. */
export const stepUpHandler: RequestHandler = async (req, res, next) => {
	try {
		const adminId = req.user?.id;
		const password = (req.body?.password ?? "").toString();
		if (!adminId || !password) {
			res.status(400).json({ error: "Password required", code: "BAD_REQUEST" });
			return;
		}
		const admin = await Admin.findById(adminId).select("+passwordHash");
		const hash = (admin as { passwordHash?: string } | null)?.passwordHash;
		if (!hash || !(await verifyPassword(password, hash))) {
			res.status(401).json({ error: "Invalid password", code: "UNAUTHORIZED" });
			return;
		}
		const config = getJwtConfig();
		if (!config) {
			res.status(503).json({ error: "JWT not configured", code: "NOT_IMPLEMENTED" });
			return;
		}
		res.status(200).json({
			stepUpToken: signStepUpToken(adminId, config),
			expiresIn: "5m",
		});
	} catch (error) {
		next(error);
	}
};

// ── Posts ─────────────────────────────────────────────────────────────────────
export const listPostsHandler: RequestHandler = async (req, res, next) => {
	try {
		const q = req.query;
		const deleted =
			q.deleted === "true" ? true : q.deleted === "false" ? false : undefined;
		res.status(200).json({
			posts: await listPostsAdmin({
				role: q.role as string | undefined,
				visibility: q.visibility as string | undefined,
				status: q.status as string | undefined,
				reported: q.reported === "true",
				deleted,
				limit: q.limit ? Number(q.limit) : undefined,
			}),
		});
	} catch (error) {
		next(error);
	}
};

export const getPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const post = await getPostAdmin(id);
		if (!post) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json({ post });
	} catch (error) {
		next(error);
	}
};

export const editPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await adminEditPost(
			req.user.id,
			id,
			{
				title: req.body?.title,
				body: req.body?.body,
				description: req.body?.description,
				visibility: req.body?.visibility,
			},
			req.body?.reason,
		);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const deletePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await adminDeletePost(req.user.id, id, req.body?.reason);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const restorePostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await adminRestorePost(req.user.id, id, req.body?.reason);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const pinPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await pinPost(req.user.id, id);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const unpinPostHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await unpinPost(req.user.id, id);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const createOfficialHandler: RequestHandler = async (req, res, next) => {
	try {
		if (!req.user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}
		const body = (req.body?.body ?? "").toString().trim();
		const title = (req.body?.title ?? "").toString().trim().slice(0, 120);
		const description = (req.body?.description ?? "").toString().trim().slice(0, 5000);
		const rawVideo = req.body?.video;
		const hasVideo =
			rawVideo && typeof rawVideo === "object" && typeof rawVideo.s3Key === "string";
		if (!body && !(req.body?.images?.length > 0) && !hasVideo) {
			res.status(400).json({ error: "Empty post", code: "BAD_REQUEST" });
			return;
		}

		// Confirm the client actually completed the presigned-PUT upload before
		// trusting the S3 key it reports.
		const video = hasVideo ? await validateUploadedVideo(rawVideo.s3Key) : undefined;

		const id = await createOfficialPost(req.user.id, {
			title,
			body,
			description,
			visibility: req.body?.visibility === "members_only" ? "members_only" : "public",
			images: Array.isArray(req.body?.images) ? req.body.images : [],
			video: video ? { s3Key: video.s3Key } : undefined,
		});
		res.status(201).json({ postId: id });
	} catch (error) {
		if (error instanceof VideoUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	}
};

export const listCommentsHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json({ comments: await listCommentsAdmin(id) });
	} catch (error) {
		next(error);
	}
};

export const deleteCommentHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await adminDeleteComment(req.user.id, id, req.body?.reason);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const versionsHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json({ versions: await getVersions(id) });
	} catch (error) {
		next(error);
	}
};

// ── Reports ─────────────────────────────────────────────────────────────────
export const listReportsHandler: RequestHandler = async (_req, res, next) => {
	try {
		res.status(200).json({ reports: await listPendingReports() });
	} catch (error) {
		next(error);
	}
};

const REPORT_ACTIONS = new Set<ReportAction>([
	"dismiss",
	"delete_content",
	"warn",
	"suspend",
	"ban",
]);

export const resolveReportHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		const action = req.body?.action as ReportAction;
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (!REPORT_ACTIONS.has(action)) {
			res.status(400).json({ error: "Invalid action", code: "BAD_REQUEST" });
			return;
		}
		const result = await resolveReport(req.user.id, id, action, req.body?.reason);
		if (!result.ok) {
			res
				.status(result.error === "not_pending" ? 409 : 400)
				.json({ error: result.error, code: "BAD_REQUEST" });
			return;
		}
		res.status(200).json({ success: true });
	} catch (error) {
		next(error);
	}
};

// ── Users ─────────────────────────────────────────────────────────────────────
export const listUsersHandler: RequestHandler = async (req, res, next) => {
	try {
		res.status(200).json({
			users: await listUsersAdmin({
				status: req.query.status as string | undefined,
				communityRole: req.query.role as string | undefined,
				limit: req.query.limit ? Number(req.query.limit) : undefined,
			}),
		});
	} catch (error) {
		next(error);
	}
};

export const getUserHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const detail = await getUserModerationDetail(id);
		if (!detail) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		res.status(200).json(detail);
	} catch (error) {
		next(error);
	}
};

const userAction =
	(
		fn: (adminId: string, userId: string, reason?: string) => Promise<boolean>,
	): RequestHandler =>
	async (req, res, next) => {
		try {
			const id = getId(req.params.id);
			if (!id || !req.user) {
				res.status(404).json(NOT_FOUND);
				return;
			}
			const ok = await fn(req.user.id, id, req.body?.reason);
			res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
		} catch (error) {
			next(error);
		}
	};

export const suspendHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const until = req.body?.until ? new Date(req.body.until) : null;
		if (until && Number.isNaN(until.getTime())) {
			res.status(400).json({ error: "Invalid date", code: "BAD_REQUEST" });
			return;
		}
		const ok = await suspendUser(req.user.id, id, until, req.body?.reason);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};

export const unsuspendHandler = userAction(unsuspendUser);
export const banHandler: RequestHandler = async (req, res, next) => {
	try {
		const id = getId(req.params.id);
		if (!id || !req.user) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		const ok = await banUser(req.user.id, id, req.body?.reason);
		res.status(ok ? 200 : 404).json(ok ? { success: true } : NOT_FOUND);
	} catch (error) {
		next(error);
	}
};
export const unbanHandler = userAction(unbanUser);
export const assignRoleHandler = userAction(assignTrainerRole);
export const revokeRoleHandler = userAction(revokeTrainerRole);
