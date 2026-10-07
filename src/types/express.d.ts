import type { CommunityUser } from "../services/community/roleResolver";
import type { StaffContext } from "../services/staffContext.service";
import type { AuthenticatedUser } from "./auth";

declare global {
	namespace Express {
		interface Request {
			user?: AuthenticatedUser;
			// Whose data this request operates on. Equals req.user.id for a
			// member acting on their own data, or the member's id when a
			// trainer/admin is acting on a member's behalf (e.g. PT logging).
			// Set by subjectIsSelf / subjectIsMember middleware.
			subjectUserId?: string;
			// Effective community identity, attached by attachCommunityContext.
			communityUser?: CommunityUser;
			// FX-17 — live staff role/branch context, attached by
			// attachStaffContext when STAFF_RBAC_ENFORCE is on.
			staffContext?: StaffContext;
			// Branches this caller may act on: null == all (global admin),
			// otherwise the caller's branch id list. Used by scopedLocationFilter.
			allowedBranchIds?: string[] | null;
		}
	}
}
