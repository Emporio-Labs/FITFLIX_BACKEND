import type { Request, RequestHandler } from "express";
import {
	BranchScopeError,
	resolveStaffContext,
} from "../services/staffContext.service";
import { resolveLocationId } from "../utils/location.resolver";
import { isStaffRbacEnforced } from "../utils/staff-rbac";
import { normalizeRole } from "./rbac.middleware";

/**
 * FX-17 — branch-scoped staff RBAC middleware.
 *
 * Two handlers, both no-ops while STAFF_RBAC_ENFORCE is off (FX-17.6):
 *   - `attachStaffContext`  re-derives the caller's live role + branches from
 *     the DB and refuses a disabled account.
 *   - `enforceBranchScope`  asserts, on writes, that the targeted branch is one
 *     the caller works at; on reads it only leaves `req.allowedBranchIds` for
 *     the controller to filter on.
 *
 * `staffGuard` composes both and is what the staff routers mount.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The branch a request targets: header wins, then body, then query. */
const readTargetBranch = (req: Request): string | undefined => {
	const header = req.header("x-location-id");
	if (header && header.trim()) return header.trim();

	const body = (req.body as { locationId?: unknown } | undefined)?.locationId;
	if (typeof body === "string" && body.trim()) return body.trim();

	const query = req.query?.locationId;
	if (typeof query === "string" && query.trim()) return query.trim();

	return undefined;
};

/**
 * Re-derive the caller's staff context on each request and attach it. Mount
 * AFTER `authenticateToken`. Sets `req.allowedBranchIds` to `null` for a global
 * admin (acts on any branch) or the caller's branch id list otherwise.
 */
export const attachStaffContext: RequestHandler = async (req, res, next) => {
	if (!isStaffRbacEnforced()) {
		next();
		return;
	}

	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	// Members acting on their own data are not branch-gated by this guard — it
	// governs staff. A member's own-data access is already scoped by their user
	// id in the controllers. Leaving `allowedBranchIds` unset means reads run
	// unscoped (null) for them, exactly as today. Mixed routers (member + staff)
	// can therefore mount the guard safely.
	if (normalizeRole(req.user.role) === "user") {
		next();
		return;
	}

	try {
		const context = await resolveStaffContext(req.user);
		if (context.disabled) {
			throw new BranchScopeError(
				"ACCOUNT_DISABLED",
				"Your account has been deactivated. Contact an administrator.",
			);
		}

		req.staffContext = context;
		req.allowedBranchIds = context.scope === "global" ? null : context.branchIds;
		next();
	} catch (error) {
		next(error);
	}
};

/**
 * Assert the request's target branch is in scope (writes only). Reads pass
 * through — their branch filtering is applied in the controllers via
 * `scopedLocationFilter`, using `req.allowedBranchIds`.
 */
export const enforceBranchScope: RequestHandler = async (req, res, next) => {
	if (!isStaffRbacEnforced()) {
		next();
		return;
	}

	// Global admins (or anything the attach step marked unscoped) act anywhere.
	if (req.allowedBranchIds == null) {
		next();
		return;
	}

	if (SAFE_METHODS.has(req.method.toUpperCase())) {
		next();
		return;
	}

	// Only assert when the request actually names a branch. Many staff
	// mutations (editing a trainer profile, inviting an admin) don't target a
	// branch at all, and branch-stamped writes that omit the id are forced to be
	// explicit by the controller's own resolveLocationId. This is the attack the
	// story describes — a staffer "editing a request" to point at another branch.
	const named = readTargetBranch(req);
	if (!named) {
		next();
		return;
	}

	try {
		// Validates the branch exists AND is active (FX-17.2), then checks scope.
		const targetId = await resolveLocationId(named);
		if (!req.allowedBranchIds.includes(String(targetId))) {
			throw new BranchScopeError(
				"NOT_YOUR_BRANCH",
				"This branch isn't one you work at.",
			);
		}

		next();
	} catch (error) {
		next(error);
	}
};

/** Composed guard the staff routers mount after `authenticateToken`. */
export const staffGuard: RequestHandler[] = [
	attachStaffContext,
	enforceBranchScope,
];
