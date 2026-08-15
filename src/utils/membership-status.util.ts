import mongoose from "mongoose";
import { MembershipStatus } from "../models/Enums";

/**
 * Canonical "is this membership usable right now" filter.
 *
 * A membership is only usable when ALL of these hold:
 *   - status is Active (not Paused / Cancelled / Expired)
 *   - it has already started
 *   - it has not ended (an absent or null endDate means open-ended)
 *
 * The date guard matters because status alone is not authoritative: the expiry
 * job flips rows to Expired on a schedule, so between a membership's endDate
 * passing and the next job run its status still reads Active. Any query that
 * checks `status: Active` WITHOUT these date bounds will happily grant access
 * on an expired membership.
 *
 * Every read that gates access or spends value must build its filter here.
 */

type UserIdInput = string | mongoose.Types.ObjectId;

/** Date bounds only — compose into a query that already has its own user/category clauses. */
export const activeDateBounds = (now: Date = new Date()) => ({
	startDate: { $lte: now },
	$or: [
		{ endDate: { $exists: false } },
		{ endDate: null },
		{ endDate: { $gte: now } },
	],
});

/**
 * Full filter for a single user's active memberships.
 *
 * Accepts a string or ObjectId. Mongo will not match an ObjectId field against
 * a string, so callers that hold a raw id must not hand-roll this.
 */
export const buildActiveMembershipFilter = (
	userId: UserIdInput,
	now: Date = new Date(),
): Record<string, unknown> => {
	const userObjectId =
		userId instanceof mongoose.Types.ObjectId
			? userId
			: new mongoose.Types.ObjectId(String(userId));

	return {
		user: userObjectId,
		status: MembershipStatus.Active,
		...activeDateBounds(now),
	};
};

/**
 * Same guard, but composed with extra clauses that themselves need `$or`.
 *
 * `activeDateBounds` already occupies the top-level `$or` key, so a caller that
 * also wants (say) `category === PT OR ptSessionsIncluded > 0` cannot simply
 * spread both — the second `$or` would clobber the first and silently drop the
 * expiry guard. This moves every disjunction into `$and` so they compose.
 */
export const buildActiveMembershipFilterWith = (
	userId: UserIdInput,
	extraClauses: Record<string, unknown>[],
	now: Date = new Date(),
): Record<string, unknown> => {
	const userObjectId =
		userId instanceof mongoose.Types.ObjectId
			? userId
			: new mongoose.Types.ObjectId(String(userId));

	return {
		user: userObjectId,
		status: MembershipStatus.Active,
		$and: [
			{ startDate: { $lte: now } },
			{
				$or: [
					{ endDate: { $exists: false } },
					{ endDate: null },
					{ endDate: { $gte: now } },
				],
			},
			...extraClauses,
		],
	};
};

/** Clauses matching a membership that carries PT entitlement. */
export const PT_MEMBERSHIP_CLAUSE = {
	$or: [{ category: "PERSONAL_TRAINING" }, { ptSessionsIncluded: { $gt: 0 } }],
};

/** Convenience: a user's active PT-bearing memberships, expiry-guarded. */
export const buildActivePtMembershipFilter = (
	userId: UserIdInput,
	now: Date = new Date(),
): Record<string, unknown> =>
	buildActiveMembershipFilterWith(userId, [PT_MEMBERSHIP_CLAUSE], now);
