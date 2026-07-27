import { Router } from "express";
import {
	assignRoleHandler,
	banHandler,
	createOfficialHandler,
	deleteCommentHandler,
	deletePostHandler,
	editPostHandler,
	getPostHandler,
	getUserHandler,
	listCommentsHandler,
	listPostsHandler,
	listReportsHandler,
	listUsersHandler,
	pinPostHandler,
	resolveReportHandler,
	restorePostHandler,
	revokeRoleHandler,
	stepUpHandler,
	suspendHandler,
	unbanHandler,
	unpinPostHandler,
	unsuspendHandler,
	versionsHandler,
} from "../controllers/community-admin.controller";
import {
	requireCommunityAdmin,
	requireStepUp,
} from "../middleware/community-admin.middleware";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { apiRateLimit } from "../middleware/rate-limit.middleware";

const communityAdminRouter = Router();

// Authenticate → require a scoped (short-TTL) admin token → rate limit.
communityAdminRouter.use(authenticateToken, requireCommunityAdmin, apiRateLimit);

// Re-auth for destructive actions.
communityAdminRouter.post("/step-up", stepUpHandler);

// Posts
communityAdminRouter.get("/posts", listPostsHandler);
communityAdminRouter.post("/posts/official", createOfficialHandler);
communityAdminRouter.get("/posts/:id/comments", listCommentsHandler);
communityAdminRouter.get("/posts/:id/versions", versionsHandler);
communityAdminRouter.get("/posts/:id", getPostHandler);
communityAdminRouter.patch("/posts/:id", editPostHandler);
communityAdminRouter.delete("/posts/:id", requireStepUp, deletePostHandler);
communityAdminRouter.post("/posts/:id/restore", restorePostHandler);
communityAdminRouter.post("/posts/:id/pin", pinPostHandler);
communityAdminRouter.post("/posts/:id/unpin", unpinPostHandler);

// Comments
communityAdminRouter.delete(
	"/comments/:id",
	requireStepUp,
	deleteCommentHandler,
);

// Reports (resolve can suspend/ban → step-up required)
communityAdminRouter.get("/reports", listReportsHandler);
communityAdminRouter.post(
	"/reports/:id/resolve",
	requireStepUp,
	resolveReportHandler,
);

// Users
communityAdminRouter.get("/users", listUsersHandler);
communityAdminRouter.get("/users/:id", getUserHandler);
communityAdminRouter.post("/users/:id/suspend", requireStepUp, suspendHandler);
communityAdminRouter.post("/users/:id/unsuspend", unsuspendHandler);
communityAdminRouter.post("/users/:id/ban", requireStepUp, banHandler);
communityAdminRouter.post("/users/:id/unban", unbanHandler);
communityAdminRouter.post("/users/:id/role", assignRoleHandler);
communityAdminRouter.delete("/users/:id/role", revokeRoleHandler);

export default communityAdminRouter;
