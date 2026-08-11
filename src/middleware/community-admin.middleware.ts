import type { RequestHandler } from "express";
import {
	decodeTokenScope,
	getJwtConfig,
	verifyStepUpToken,
} from "../utils/jwt";

const getBearer = (authorization: string | undefined): string | null => {
	if (!authorization) return null;
	const [scheme, token] = authorization.split(" ");
	return scheme === "Bearer" && token ? token.trim() : null;
};

/**
 * Gate for community-admin endpoints. Requires an authenticated admin whose
 * token carries the hardened `admin` scope — a legacy long-lived admin token
 * without the scope is rejected, forcing a fresh (short-TTL) admin login.
 * Mount AFTER `authenticateToken`.
 */
export const requireCommunityAdmin: RequestHandler = (req, res, next) => {
	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({ error: "Admin access only", code: "FORBIDDEN" });
		return;
	}
	const token = getBearer(req.header("authorization"));
	if (!token || decodeTokenScope(token) !== "admin") {
		res.status(401).json({
			error: "Admin re-login required.",
			code: "ADMIN_SCOPE_REQUIRED",
		});
		return;
	}
	next();
};

/**
 * Require a fresh step-up token (from re-entering the password) for destructive
 * actions: delete post, delete comment, suspend, ban. Sent as `X-Step-Up-Token`.
 */
export const requireStepUp: RequestHandler = (req, res, next) => {
	const config = getJwtConfig();
	const token = req.header("x-step-up-token");
	if (
		!config ||
		!req.user ||
		!token ||
		!verifyStepUpToken(token, req.user.id, config)
	) {
		res.status(401).json({
			error: "Re-authentication required for this action.",
			code: "STEP_UP_REQUIRED",
		});
		return;
	}
	next();
};
