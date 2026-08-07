import Membership from "../models/Membership";
import { MembershipStatus } from "../models/Enums";

/**
 * Returns the first active, non-expired membership for the given userId,
 * or null if none exists.
 *
 * Active = status is "Active" AND startDate <= now AND (no endDate OR endDate >= now).
 */
export async function getActiveMembership(userId: string) {
	const now = new Date();

	return Membership.findOne({
		user: userId,
		status: MembershipStatus.Active,
		startDate: { $lte: now },
		$or: [{ endDate: null }, { endDate: { $exists: false } }, { endDate: { $gte: now } }],
	})
		.select("_id planName endDate creditsRemaining")
		.lean();
}
