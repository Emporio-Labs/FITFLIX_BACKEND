import { CommunityRole, PostVisibility, UserStatus } from "../../models/Enums";
import type { CommunityUser } from "./roleResolver";

/**
 * The single community permission module. One function — {@link can} — is the
 * ONLY place authorization is decided; every future endpoint must call it
 * rather than re-checking roles inline.
 */
export type CommunityAction =
	| "post:create"
	| "post:edit"
	| "post:delete"
	| "post:view"
	| "post:like"
	| "post:share"
	| "post:comment"
	| "post:repost"
	| "history:view"
	| "comment:create"
	| "comment:edit"
	| "comment:delete"
	| "comment:like"
	| "user:block"
	| "report:create";

/** Minimal resource shape the policy needs to reason about a post. */
export interface PolicyPost {
	authorId: string;
	// Accepts the enum or a raw string; compared against PostVisibility values.
	visibility: string;
	// Snapshotted community role of the post's author. Optional so existing
	// callers stay source-compatible; required for `post:repost` gating.
	authorRole?: string;
}

export type PolicyResource = PolicyPost | undefined;

// Actions that mutate state. All of these require an active (non-suspended,
// non-banned) account.
const WRITE_ACTIONS: ReadonlySet<CommunityAction> = new Set([
	"post:create",
	"post:edit",
	"post:delete",
	"post:comment",
	"post:repost",
	"post:like",
	"post:share",
	"comment:create",
	"comment:edit",
	"comment:delete",
	"comment:like",
	"user:block",
	"report:create",
]);

const isStaffOrInsider = (user: CommunityUser): boolean =>
	user.role === CommunityRole.Insider ||
	user.role === CommunityRole.Trainer ||
	user.role === CommunityRole.Admin;

const isAuthor = (user: CommunityUser, resource?: PolicyResource): boolean =>
	Boolean(resource?.authorId) && resource?.authorId === user.id;

// PostVisibility.Public === "public" at runtime, so this also matches a raw
// "public" string coming from a plain JSON resource.
const isPublic = (resource?: PolicyResource): boolean =>
	resource?.visibility === PostVisibility.Public;

/**
 * Decide whether `user` may perform `action` on an optional `resource`.
 *
 * Precedence and rules mirror the community brief exactly:
 *  - active admin short-circuits to allow.
 *  - any write requires an active account (suspended/banned are denied).
 *  - create/comment  → insider | trainer | admin
 *  - edit/delete     → author | admin
 *  - view            → public, or any non-outsider (has active membership)
 *  - like/share      → any active, non-banned user (outsiders included)
 *  - repost          → admin ONLY (disabled for everyone else)
 *  - history:view    → post author ONLY, or admin (read-only for all)
 */
export function can(
	user: CommunityUser,
	action: CommunityAction,
	resource?: PolicyResource,
): boolean {
	if (!user) {
		return false;
	}

	// Share is PUBLIC-ONLY for everyone — even an admin. Premium (members_only)
	// content must never be shared out of the app, so this runs BEFORE the admin
	// short-circuit. With no resource (generic capability check) it only gates on
	// an active account.
	if (action === "post:share") {
		if (user.status !== UserStatus.Active) return false;
		if (resource && !isPublic(resource)) return false;
		return true;
	}

	// Admin short-circuit — full access.
	if (user.role === CommunityRole.Admin && user.status === UserStatus.Active) {
		return true;
	}

	// Writes require an active account. This is the single suspend/ban gate.
	if (WRITE_ACTIONS.has(action) && user.status !== UserStatus.Active) {
		return false;
	}

	switch (action) {
		case "post:create":
		case "post:comment":
		case "comment:create":
			return isStaffOrInsider(user);

		case "post:edit":
		case "post:delete":
		case "comment:edit":
		case "comment:delete":
			// Admin already handled by the short-circuit above. For comments the
			// resource carries the comment's authorId.
			return isAuthor(user, resource);

		case "post:like":
		case "comment:like":
		case "user:block":
		case "report:create":
			// Status already gated to active above; outsiders are allowed. (Like a
			// members_only post is separately blocked by a post:view check.)
			return true;

		case "post:view":
			return isPublic(resource) || user.role !== CommunityRole.Outsider;

		case "post:repost":
			// Insiders (or higher) may repost a Trainer-authored PUBLIC post.
			// Admin already returned true above; trainers can also repost.
			if (!isStaffOrInsider(user)) return false;
			if (!resource) return false;
			if (!isPublic(resource)) return false;
			return resource.authorRole === CommunityRole.Trainer;

		case "history:view":
			// Author only; admin already handled by the short-circuit.
			return isAuthor(user, resource);

		default:
			return false;
	}
}
