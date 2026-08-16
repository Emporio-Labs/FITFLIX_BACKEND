import mongoose from "mongoose";
import { normalizeRole } from "../middleware/rbac.middleware";
import type { AppUserRole } from "../types/auth";

/**
 * Who sees what, as a pure function.
 *
 * The visibility split is the whole security surface of the promotions API, so
 * it lives here rather than inline in the controller — that keeps it coverable
 * without standing up a server or a database.
 */

/**
 * Staff may ask for promotions that are switched off or outside their window;
 * everyone else only ever sees what is live right now.
 *
 * Roles arrive on `req.user` raw from the token — `authenticateToken` does not
 * normalise them, `authorize` does it internally. Comparing the raw value would
 * silently deny a legitimate `staff` or `ROLE_FRONT_DESK_STAFF` token, so this
 * normalises first.
 */
export const canSeeHiddenPromotions = (
	role: AppUserRole | null | undefined,
): boolean => {
	if (!role) return false;
	const normalized = normalizeRole(role);
	return normalized === "admin" || normalized === "frontdesk";
};

export interface PromotionFilterOptions {
	/** Raw role off `req.user`; absent for the pre-login public route. */
	role?: AppUserRole | null;
	now?: Date;
	/** Branch to scope to. Absent means no location constraint at all. */
	locationId?: string | null;
	/** Honoured for staff only. */
	includeInactive?: boolean;
	/**
	 * The *viewer's* segment, from utils/membership.guard. Absent imposes no
	 * audience constraint, which is what the admin list wants — staff manage
	 * every promotion regardless of who it is aimed at.
	 */
	audience?: "member" | "lapsed" | "non_member" | null;
}

export const buildPromotionFilter = ({
	role = null,
	now = new Date(),
	locationId = null,
	includeInactive = false,
	audience = null,
}: PromotionFilterOptions = {}): Record<string, unknown> => {
	const filter: Record<string, unknown> = {};

	// `null` in the list is load-bearing: Mongo's $in matches a missing field
	// against null, and every promotion written before this field existed has
	// no `audience` at all. Without it, adding audience targeting would have
	// silently hidden the entire existing catalogue.
	if (audience) {
		filter.audience = { $in: ["all", audience, null] };
	}

	// Company-wide promotions ride along with a branch's own rather than being
	// shadowed by them. Asking for no branch imposes no constraint, which is
	// what the admin list wants when no location scope is selected.
	if (locationId) {
		filter.locationId = {
			$in: [new mongoose.Types.ObjectId(locationId), null],
		};
	}

	if (includeInactive && canSeeHiddenPromotions(role)) {
		return filter;
	}

	filter.isActive = true;
	filter.activeFrom = { $lte: now };
	filter.activeTo = { $gte: now };

	return filter;
};

/** Higher priority first, then the most recently started promotion. */
export const PROMOTION_SORT = { priority: -1, activeFrom: -1 } as const;
