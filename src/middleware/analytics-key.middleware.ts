import type { RequestHandler } from "express";

/**
 * FX-27.3 — service-to-service gate for the branch analytics endpoint.
 *
 * The Frontdesk web app never calls `/analytics/funnels` from the browser; its
 * Next.js server proxy does, holding a secret in a server-only env var and
 * attaching it as the `X-Analytics-Key` header. This middleware validates that
 * key so only that trusted server — not an arbitrary client that happens to
 * hold a staff JWT — can pull the funnels. It is layered ON TOP of the JWT +
 * role + branch-scope guards, never instead of them.
 *
 * When `ANALYTICS_API_KEY` is unset the check is skipped (the JWT + role +
 * branch guards still protect the route), so existing deployments and local dev
 * keep working without the extra secret. Set it on BOTH the backend and the
 * Frontdesk server to the SAME value to turn the service gate on. Mirrors the
 * optional-secret idiom in internal.routes.ts (`verifyInternalSecret`), except
 * that one rejects when unset because its routes have no other auth.
 */
export const requireAnalyticsKey: RequestHandler = (req, res, next) => {
	const expected = process.env.ANALYTICS_API_KEY?.trim();
	if (!expected) {
		next();
		return;
	}

	const provided = (req.header("x-analytics-key") ?? "").trim();
	if (provided !== expected) {
		res
			.status(403)
			.json({ error: "Invalid analytics service key", code: "FORBIDDEN" });
		return;
	}

	next();
};
