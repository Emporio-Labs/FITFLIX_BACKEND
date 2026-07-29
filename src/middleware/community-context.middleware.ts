import type { RequestHandler } from "express";
import { resolveCommunityUser } from "../services/community/roleResolver";

/**
 * Resolves the caller's effective community role + status on each request and
 * attaches it as `req.communityUser`. Mount AFTER `authenticateToken` (which
 * populates `req.user`); this extends the existing auth flow, it does not
 * replace it.
 *
 * Because it re-derives insider status from a live membership lookup on every
 * request, an expired membership stops conferring insider rights immediately —
 * the long-lived (240d) JWT is never trusted for membership state.
 *
 * Wiring into routes lands with the community endpoints; Day 1 ships the
 * resolver + policy this middleware feeds, exercised directly by the tests.
 */
export const attachCommunityContext: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		req.communityUser = await resolveCommunityUser(req.user);
		next();
	} catch (error) {
		next(error);
	}
};
