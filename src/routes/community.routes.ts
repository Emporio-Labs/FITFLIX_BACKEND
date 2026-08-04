import { type RequestHandler, Router } from "express";
import multer from "multer";
import { communityConfig } from "../config/community";
import {
	createPostHandler,
	deletePostHandler,
	editPostHandler,
	getFeedHandler,
	getPostHandler,
	getVersionsHandler,
	presignVideoUploadHandler,
	restorePostHandler,
	uploadAudioHandler,
	uploadFilesHandler,
	uploadImagesHandler,
} from "../controllers/community.controller";
import {
	blockUserHandler,
	createCommentHandler,
	deleteCommentHandler,
	editCommentHandler,
	likeCommentHandler,
	likePostHandler,
	listBlocksHandler,
	listCommentsHandler,
	reportHandler,
	sharePostHandler,
	unblockUserHandler,
	unlikeCommentHandler,
	unlikePostHandler,
} from "../controllers/community-engagement.controller";
import {
	getMyProfileHandler,
	getPublicProfileHandler,
	listUserPostsHandler,
	removeAvatarHandler,
	searchPeopleHandler,
	updateMyProfileHandler,
	uploadAvatarHandler,
} from "../controllers/community-profile.controller";
import { attachCommunityContext } from "../middleware/community-context.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { apiRateLimit } from "../middleware/rate-limit.middleware";
import {
	audioUploadMiddleware,
	fileUploadMiddleware,
	uploadMiddleware,
	uploadRateLimiter,
} from "../middleware/upload.middleware";

const communityRouter = Router();

// Every community route: authenticate, resolve the effective role, rate limit
// (post/comment/like/report/share writes + reads). Uploads add their own limiter.
communityRouter.use(authenticateToken, attachCommunityContext, apiRateLimit);

/**
 * Runs the multer array upload and maps its errors to clean 4xx responses
 * (oversized → 413, too many files → 400, bad declared type → 415) instead of
 * letting a MulterError fall through to the generic 500 handler.
 */
const uploadImagesMulter: RequestHandler = (req, res, next) => {
	uploadMiddleware.array("images", communityConfig.maxImagesPerPost)(
		req,
		res,
		(err: unknown) => {
			if (!err) {
				next();
				return;
			}
			if (err instanceof multer.MulterError) {
				const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
				res
					.status(status)
					.json({ error: `Upload rejected: ${err.message}`, code: err.code });
				return;
			}
			// fileFilter rejection (unsupported declared MIME type).
			res.status(415).json({
				error: (err as Error).message || "Unsupported file",
				code: "UNSUPPORTED_MEDIA_TYPE",
			});
		},
	);
};

/**
 * Single-file avatar upload. Field name is `image` (singular) to keep it
 * distinct from the post-attachment field `images`. Same limits and error
 * mapping as the image endpoint.
 */
const uploadAvatarMulter: RequestHandler = (req, res, next) => {
	uploadMiddleware.single("image")(req, res, (err: unknown) => {
		if (!err) {
			next();
			return;
		}
		if (err instanceof multer.MulterError) {
			const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
			res
				.status(status)
				.json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		res.status(415).json({
			error: (err as Error).message || "Unsupported file",
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
};

communityRouter.get("/feed", getFeedHandler);

communityRouter.post(
	"/media/images",
	uploadRateLimiter,
	uploadImagesMulter,
	uploadImagesHandler,
);

/**
 * General file upload: images, PDFs, DOCX, videos — up to 10 files, 50 MB each.
 * Multer errors map to 413 / 400 / 415 as with the image endpoint.
 */
const uploadFilesMulter: RequestHandler = (req, res, next) => {
	fileUploadMiddleware.array("files", 10)(req, res, (err: unknown) => {
		if (!err) {
			next();
			return;
		}
		if (err instanceof multer.MulterError) {
			const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
			res.status(status).json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		res.status(415).json({
			error: (err as Error).message || "Unsupported file",
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
};

communityRouter.post(
	"/media/files",
	uploadRateLimiter,
	uploadFilesMulter,
	uploadFilesHandler,
);

/** Single-clip audio upload. Field name: `audio`. */
const uploadAudioMulter: RequestHandler = (req, res, next) => {
	audioUploadMiddleware.single("audio")(req, res, (err: unknown) => {
		if (!err) {
			next();
			return;
		}
		if (err instanceof multer.MulterError) {
			const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
			res
				.status(status)
				.json({ error: `Upload rejected: ${err.message}`, code: err.code });
			return;
		}
		res.status(415).json({
			error: (err as Error).message || "Unsupported file",
			code: "UNSUPPORTED_MEDIA_TYPE",
		});
	});
};

communityRouter.post(
	"/media/audio",
	uploadRateLimiter,
	uploadAudioMulter,
	uploadAudioHandler,
);

/**
 * Presign a direct-to-S3 video upload. No multer here — the client PUTs the
 * file straight to S3 with the returned URL, so this endpoint only ever
 * receives a small JSON body (filename/contentType/contentLength).
 */
communityRouter.post(
	"/media/video/presign",
	uploadRateLimiter,
	presignVideoUploadHandler,
);

communityRouter.post("/posts", createPostHandler);
communityRouter.get("/posts/:id/versions", getVersionsHandler);
communityRouter.post("/posts/:id/restore", restorePostHandler);

// ── Engagement (Day 4) ──────────────────────────────────────────────────────
communityRouter.post("/posts/:id/like", likePostHandler);
communityRouter.delete("/posts/:id/like", unlikePostHandler);
communityRouter.post("/posts/:id/share", sharePostHandler);
communityRouter.get("/posts/:id/comments", listCommentsHandler);
communityRouter.post("/posts/:id/comments", createCommentHandler);
communityRouter.post("/comments/:id/like", likeCommentHandler);
communityRouter.delete("/comments/:id/like", unlikeCommentHandler);
communityRouter.patch("/comments/:id", editCommentHandler);
communityRouter.delete("/comments/:id", deleteCommentHandler);
// ── Profiles ────────────────────────────────────────────────────────────────
// Registered BEFORE the /users/:id/* routes below so every literal path segment
// wins over a pattern. "/profile/me" uses a literal first segment, so the
// me-vs-:id ambiguity never arises at all.
communityRouter.get("/profile/me", getMyProfileHandler);
communityRouter.patch("/profile/me", updateMyProfileHandler);
communityRouter.post(
	"/profile/me/avatar",
	uploadRateLimiter,
	uploadAvatarMulter,
	uploadAvatarHandler,
);
communityRouter.delete("/profile/me/avatar", removeAvatarHandler);
// Literal "search" must be registered ahead of the "/users/:id/*" patterns.
communityRouter.get("/users/search", searchPeopleHandler);
communityRouter.get("/users/:id/profile", getPublicProfileHandler);
communityRouter.get("/users/:id/posts", listUserPostsHandler);

communityRouter.post("/users/:id/block", blockUserHandler);
communityRouter.delete("/users/:id/block", unblockUserHandler);
communityRouter.get("/blocks", listBlocksHandler);
communityRouter.post("/reports", reportHandler);

communityRouter.get("/posts/:id", getPostHandler);
communityRouter.patch("/posts/:id", editPostHandler);
communityRouter.delete("/posts/:id", deletePostHandler);

export default communityRouter;
