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

