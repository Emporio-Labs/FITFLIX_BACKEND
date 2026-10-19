import mongoose from "mongoose";

/**
 * FX-20.2 — which classes a member may see.
 *
 * In-person classes (mode `offline`/`hybrid`) belong to a branch, so a member
 * only sees the ones at their home club plus any that are company-wide (no
 * branch stamped). Online classes and live streams are location-independent and
 * stay visible to every member regardless of home club.
 *
 * When the member has no home club — a single-branch chain, or a member who was
 * never assigned one — the branch split is dropped entirely and every active
 * class shows. That is what keeps FX-20.4 true: with one branch the app looks
 * exactly as it does today.
 *
 * The rule lives here as pure functions (mirroring utils/promotion-visibility)
 * so both the catalogue listing (Class query) and the dated-session feed
 * (post-populate filter) apply the identical split without a server/DB.
 */

/**
 * A class is "broadcast" — seen by every member regardless of branch — when it
 * is delivered online or is a live stream. Everything else is in-person and
 * branch-bound.
 */
export const isBroadcastClass = (klass: {
	mode?: string | null;
	sessionType?: string | null;
}): boolean => klass?.mode === "online" || klass?.sessionType === "live_stream";

/**
 * The `$or` fragment that scopes a Class query to a member's home club, to be
 * AND-ed with the caller's other filters (status, isPublished, …).
 *
 * Returns `null` when no branch scoping applies (the member has no home club),
 * so the caller leaves the query untouched and every active class shows.
 */
export const memberClassVisibilityOr = (
	homeLocationId?: string | mongoose.Types.ObjectId | null,
): Record<string, unknown>[] | null => {
	if (!homeLocationId || !mongoose.Types.ObjectId.isValid(String(homeLocationId))) {
		return null;
	}
	const branch = new mongoose.Types.ObjectId(String(homeLocationId));
	return [
		// Broadcast — online or livestream — reaches every member.
		{ mode: "online" },
		{ sessionType: "live_stream" },
		// In-person — this member's home club, plus company-wide (null branch).
		{ locationId: { $in: [branch, null] } },
	];
};

/**
 * Post-populate counterpart for the dated-session feed, where the branch/mode
 * live on the populated `classId`. Answers "may a member whose home club is
 * `homeLocationId` see a session of this class?" — `homeLocationId` null means
 * no scoping (show everything).
 */
export const isClassVisibleToMember = (
	klass: {
		mode?: string | null;
		sessionType?: string | null;
		locationId?: unknown;
	} | null | undefined,
	homeLocationId: string | null,
): boolean => {
	if (!klass) return false;
	if (!homeLocationId) return true;
	if (isBroadcastClass(klass)) return true;
	const classBranch = klass.locationId ? String(klass.locationId) : null;
	// In-person: company-wide (no branch) or the member's own home club.
	return classBranch === null || classBranch === homeLocationId;
};
