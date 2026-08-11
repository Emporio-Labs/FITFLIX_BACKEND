import { CommunityRole, MembershipStatus, UserStatus } from "../../models/Enums";
import Membership from "../../models/Membership";
import User from "../../models/User";
import type { AuthenticatedUser } from "../../types/auth";

/**
 * The caller's effective community identity, resolved fresh on each request.
 * `role` is DERIVED (never stored, never in the JWT); `status` gates suspend/ban.
 */
export interface CommunityUser {
	id: string;
	role: CommunityRole;
	status: UserStatus;
}

/**
 * Live membership check — the single source of truth for insider status.
 * Mirrors the existing predicate in reminder.service.ts: an Active membership
 * whose endDate is still in the future. A membership that expired yesterday no
 * longer matches, so the caller resolves to outsider.
 *
 * Re-run this on every WRITE so an expired membership can't keep posting on the
 * strength of a long-lived (240d) token.
 */
export async function hasActiveMembership(userId: string): Promise<boolean> {
	const exists = await Membership.exists({
		user: userId,
		status: MembershipStatus.Active,
		endDate: { $gt: new Date() },
	});
	return Boolean(exists);
}

/**
 * Resolve the effective community role + account status for an authenticated
 * caller. Precedence: admin > trainer > insider (active membership) > outsider.
 *
 * Staff roles (admin/trainer) come from the JWT identity — they live in their
 * own collections and are treated as active for community purposes. Everyone
 * else is an app member whose insider/outsider status is derived from a live
 * membership lookup and whose suspend/ban state comes from User.status.
 */
export async function resolveCommunityUser(
	authUser: AuthenticatedUser,
): Promise<CommunityUser> {
	if (authUser.role === "admin") {
		return {
			id: authUser.id,
			role: CommunityRole.Admin,
			status: UserStatus.Active,
		};
	}

	if (authUser.role === "trainer") {
		return {
			id: authUser.id,
			role: CommunityRole.Trainer,
			status: UserStatus.Active,
		};
	}

	// App member/user path. `.lean()` skips schema defaults, so treat a missing
	// status (legacy users) as active.
	const user = await User.findById(authUser.id)
		.select("status communityRole")
		.lean<{ status?: UserStatus; communityRole?: string | null } | null>();
	const status = user?.status ?? UserStatus.Active;

	// An admin-granted community elevation wins over the derived member role.
	if (user?.communityRole === CommunityRole.Trainer) {
		return { id: authUser.id, role: CommunityRole.Trainer, status };
	}

	const role = (await hasActiveMembership(authUser.id))
		? CommunityRole.Insider
		: CommunityRole.Outsider;

	return { id: authUser.id, role, status };
}
