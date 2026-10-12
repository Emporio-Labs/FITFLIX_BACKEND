import mongoose from "mongoose";
import { MembershipStatus } from "../models/Enums";
import Membership from "../models/Membership";
import User from "../models/User";

/**
 * FX-20.3 — who a club notification actually reaches.
 *
 * The base set is the club's *members*: User docs with no `staffRole` (staff
 * Users carry one) whose `homeLocationId` is the target branch. A company-wide
 * send (`locationId` null) drops the branch filter and spans every club. The
 * base set is then narrowed to the audience segment, derived from the
 * Membership ledger exactly like utils/membership.guard — never from the
 * defaulted `User.membershipStatus`, which reads "ACTIVE" on every signup and
 * would mislabel a non-member as a member.
 */

export type ClubNotificationAudience = "all" | "member" | "lapsed";

/** De-dupe + coerce mixed id storage (ObjectId or string) to ObjectIds. */
const toObjectIds = (values: unknown[]): mongoose.Types.ObjectId[] => {
	const seen = new Set<string>();
	const out: mongoose.Types.ObjectId[] = [];
	for (const value of values) {
		const key = String(value);
		if (seen.has(key) || !mongoose.Types.ObjectId.isValid(key)) continue;
		seen.add(key);
		out.push(new mongoose.Types.ObjectId(key));
	}
	return out;
};

const activeMembershipCriteria = (now: Date) => ({
	status: MembershipStatus.Active,
	startDate: { $lte: now },
	$or: [
		{ endDate: null },
		{ endDate: { $exists: false } },
		{ endDate: { $gte: now } },
	],
});

/**
 * Resolve the exact recipient user ids for a club broadcast. Returns `[]` when
 * no member matches (an empty audience is a valid, zero-recipient send).
 */
export const resolveClubRecipientIds = async ({
	locationId,
	audience,
}: {
	locationId: string | null;
	audience: ClubNotificationAudience;
}): Promise<mongoose.Types.ObjectId[]> => {
	// Members only — staff Users carry a staffRole.
	const base: Record<string, unknown> = {
		$or: [{ staffRole: null }, { staffRole: { $exists: false } }],
	};
	if (locationId && mongoose.Types.ObjectId.isValid(locationId)) {
		base.homeLocationId = new mongoose.Types.ObjectId(locationId);
	}

	if (audience === "all") {
		return toObjectIds(await User.find(base).distinct("_id"));
	}

	const now = new Date();
	const activeUserIds = toObjectIds(
		await Membership.distinct("user", activeMembershipCriteria(now)),
	);

	if (audience === "member") {
		if (activeUserIds.length === 0) return [];
		return toObjectIds(
			await User.find({ ...base, _id: { $in: activeUserIds } }).distinct("_id"),
		);
	}

	// Lapsed = ever held a membership, none active now.
	const everHadIds = toObjectIds(await Membership.distinct("user", {}));
	const activeSet = new Set(activeUserIds.map(String));
	const lapsedIds = everHadIds.filter((id) => !activeSet.has(String(id)));
	if (lapsedIds.length === 0) return [];
	return toObjectIds(
		await User.find({ ...base, _id: { $in: lapsedIds } }).distinct("_id"),
	);
};
