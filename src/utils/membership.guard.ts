import mongoose from "mongoose";
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
	const userQuery = mongoose.Types.ObjectId.isValid(userId)
		? [{ user: userId }, { user: new mongoose.Types.ObjectId(userId) }]
		: [{ user: userId }];

	return Membership.findOne({
		$or: userQuery,
		status: MembershipStatus.Active,
		startDate: { $lte: now },
		$and: [
			{
				$or: [
					{ endDate: null },
					{ endDate: { $exists: false } },
					{ endDate: { $gte: now } },
				],
			},
		],
	})
		.select("_id planName endDate creditsRemaining")
		.lean();
}

/**
 * Which marketing audience a person falls into.
 *
 * Three states, not two, because "never joined" and "used to be a member" want
 * opposite pitches — one needs convincing the club is worth trying, the other
 * already knows and needs a reason to come back. Collapsing them is how a
 * lapsed member gets sold an introduction they sat through two years ago.
 *
 * Deliberately derived from the Membership collection rather than from
 * `User.membershipStatus`: that field defaults to "ACTIVE" on every new user,
 * so a signed-up non-member reads as a member through it. Do not swap this
 * for the cheaper lookup.
 */
export type MemberAudience = "member" | "lapsed" | "non_member";

export async function resolveMemberAudience(
	userId: string,
): Promise<MemberAudience> {
	if (await getActiveMembership(userId)) return "member";

	const userQuery = mongoose.Types.ObjectId.isValid(userId)
		? [{ user: userId }, { user: new mongoose.Types.ObjectId(userId) }]
		: [{ user: userId }];

	// Any membership at all, in any state — having once paid is what separates
	// lapsed from never-joined.
	const everHadOne = await Membership.exists({ $or: userQuery });
	return everHadOne ? "lapsed" : "non_member";
}

