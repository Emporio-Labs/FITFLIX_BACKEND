import mongoose from "mongoose";
import Admin from "../models/Admin";
import Trainer from "../models/Trainer";
import User from "../models/User";
import type { AuthenticatedUser } from "../types/auth";

/**
 * FX-17 — branch-scoped staff RBAC.
 *
 * A staff member's authority is re-derived from the live database on every
 * request, NOT trusted from the JWT. Tokens here live up to 240 days and carry
 * only { sub, email, role } with no branch claim, so disabling a staffer or
 * changing their role/branches could otherwise take months to take effect. A
 * short-TTL cache (below) bounds the propagation delay to ~1 minute (FX-17.5).
 *
 * Scope model (locked with the product owner):
 *   - Admin-collection accounts are GLOBAL super admins — they act on any
 *     branch and bypass branch scoping entirely (FX-17.4).
 *   - Trainers / expert+frontdesk Users are BRANCH-scoped to their branchIds.
 */

export type StaffScope = "global" | "branch";

export interface StaffContext {
	id: string;
	/** "global" bypasses branch scoping; "branch" is limited to `branchIds`. */
	scope: StaffScope;
	/** Branch ids this staffer may act on. Ignored when scope is "global". */
	branchIds: string[];
	/** True when the account is deactivated/disabled — the guard refuses it. */
	disabled: boolean;
}

export type BranchScopeErrorCode =
	| "NOT_YOUR_BRANCH"
	| "ACCOUNT_DISABLED"
	| "INVALID_ARGUMENT";

/**
 * A staff member tried to act outside their branch scope, or on a disabled
 * account. Mapped to HTTP 403 in utils/api-error.ts (mirrors TrainerRosterError
 * / NOT_YOUR_MEMBER).
 */
export class BranchScopeError extends Error {
	public readonly code: BranchScopeErrorCode;

	constructor(code: BranchScopeErrorCode, message: string) {
		super(message);
		this.name = "BranchScopeError";
		this.code = code;
	}
}

/* ---------------------------------------------------------------------------
 * Short-TTL cache (FX-17.5)
 *
 * 60s so an admin disabling a staffer or moving them between branches sees it
 * take effect within a minute, while a burst of requests on one long-lived
 * token does not hit the DB on every call. Hand-rolled Map+expiresAt, matching
 * the cache convention in utils/location.resolver.ts (no Redis in this repo).
 * ------------------------------------------------------------------------- */

const STAFF_CONTEXT_CACHE_TTL_MS = 60_000;

const staffContextCache = new Map<
	string,
	{ value: StaffContext; expiresAt: number }
>();

const cacheRead = (key: string): StaffContext | undefined => {
	const hit = staffContextCache.get(key);
	if (!hit) return undefined;
	if (hit.expiresAt <= Date.now()) {
		staffContextCache.delete(key);
		return undefined;
	}
	return hit.value;
};

const cacheWrite = (key: string, value: StaffContext): StaffContext => {
	staffContextCache.set(key, {
		value,
		expiresAt: Date.now() + STAFF_CONTEXT_CACHE_TTL_MS,
	});
	return value;
};

/**
 * Drop cached staff contexts. Call after an admin changes a staffer's role,
 * branches or active state so the change takes effect immediately rather than
 * after the TTL; also used by tests. Passing an id clears just that staffer.
 */
export const clearStaffContextCache = (userId?: string): void => {
	if (userId) {
		staffContextCache.delete(`staff:${String(userId)}`);
		return;
	}
	staffContextCache.clear();
};

const toIdStrings = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.map((v) => String(v)).filter((v) => v.length > 0);
};

/**
 * Resolve the caller's current staff context from the database.
 *
 * Looks the caller up by id across Admin / Trainer / User (the same three
 * collections login matches against). The first hit wins in that order, which
 * matches login precedence (admin > trainer > user). A caller we cannot place
 * resolves to an empty branch scope — a branch-scoped identity with no branches
 * can act on nothing, which is the safe default under enforcement.
 */
export const resolveStaffContext = async (
	authUser: AuthenticatedUser,
): Promise<StaffContext> => {
	const id = String(authUser.id);
	if (!mongoose.Types.ObjectId.isValid(id)) {
		throw new BranchScopeError("INVALID_ARGUMENT", "Invalid caller id");
	}

	const cached = cacheRead(`staff:${id}`);
	if (cached) return cached;

	// Admin — global super admin (acts on any branch).
	const admin = await Admin.findById(id).select("_id status isActive").lean<
		{ status?: string; isActive?: boolean } | null
	>();
	if (admin) {
		const disabled =
			admin.isActive === false ||
			String(admin.status ?? "").toLowerCase() === "disabled";
		return cacheWrite(`staff:${id}`, {
			id,
			scope: "global",
			branchIds: [],
			disabled,
		});
	}

	// Trainer — branch-scoped. Prefer the plural branchIds, fall back to the
	// legacy single locationId so existing records keep working.
	const trainer = await Trainer.findById(id)
		.select("_id branchIds locationId isActive")
		.lean<
			{ branchIds?: unknown; locationId?: unknown; isActive?: boolean } | null
		>();
	if (trainer) {
		const branchIds = toIdStrings(trainer.branchIds);
		if (branchIds.length === 0 && trainer.locationId) {
			branchIds.push(String(trainer.locationId));
		}
		return cacheWrite(`staff:${id}`, {
			id,
			scope: "branch",
			branchIds,
			disabled: trainer.isActive === false,
		});
	}

	// User — branch-scoped only when acting as staff (staffRole set). A plain
	// member is never branch-gated by this guard (member routes aren't wired).
	const user = await User.findById(id)
		.select("_id branchIds homeLocationId isActive staffRole status")
		.lean<
			{
				branchIds?: unknown;
				homeLocationId?: unknown;
				isActive?: boolean;
				staffRole?: string | null;
				status?: string;
			} | null
		>();
	if (user) {
		const branchIds = toIdStrings(user.branchIds);
		if (branchIds.length === 0 && user.homeLocationId) {
			branchIds.push(String(user.homeLocationId));
		}
		const disabled =
			user.isActive === false ||
			String(user.status ?? "").toLowerCase() === "disabled";
		return cacheWrite(`staff:${id}`, {
			id,
			scope: "branch",
			branchIds,
			disabled,
		});
	}

	// Unknown identity — treat as a branch-scoped caller with no branches.
	return cacheWrite(`staff:${id}`, {
		id,
		scope: "branch",
		branchIds: [],
		disabled: false,
	});
};
