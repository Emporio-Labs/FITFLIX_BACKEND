import mongoose from "mongoose";
import {
	CreditTransactionSource,
	CreditTransactionType,
	MembershipStatus,
} from "../models/Enums";
import CreditTransaction from "../models/CreditTransaction";
import Membership from "../models/Membership";
import { getLocationSettings } from "../utils/location.resolver";
import { executeInTransaction } from "../utils/transaction.util";

/**
 * Membership lifecycle: expiry and freeze/resume.
 *
 * Before this existed, MembershipStatus.Expired was declared in the enum but
 * never written by any code path — expiry was enforced only implicitly by
 * date-bounded queries. That left two problems this module closes:
 *
 *   1. Unused credits and PT sessions became unreachable at endDate with no
 *      ledger entry at all, so granted value simply vanished and the books
 *      never reconciled. Expiry now writes an explicit Void transaction.
 *   2. Pausing blocked access but never extended endDate, so a freeze silently
 *      burned paid days. Resume now credits them back, capped per location.
 */

export class MembershipLifecycleError extends Error {
	code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "MembershipLifecycleError";
		this.code = code;
	}
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type ExpiryRunSummary = {
	scanned: number;
	expired: number;
	creditsWrittenOff: number;
	ptSessionsWrittenOff: number;
	errors: number;
};

/**
 * Flip every lapsed membership to Expired and write off whatever value was
 * left on it.
 *
 * Idempotent: the status filter means an already-expired membership is never
 * scanned twice, so a duplicate run cannot double-write ledger rows.
 */
export const expireMemberships = async (
	now: Date = new Date(),
	options: { dryRun?: boolean } = {},
): Promise<ExpiryRunSummary> => {
	// MEMBERSHIP_EXPIRY_DRY_RUN=1 reports what would lapse without writing
	// anything. Worth using for the first run against a database that has never
	// had an expiry sweep, since every already-lapsed membership is caught at
	// once and the write-off is not reversible.
	const dryRun =
		options.dryRun ?? process.env.MEMBERSHIP_EXPIRY_DRY_RUN === "1";

	const summary: ExpiryRunSummary = {
		scanned: 0,
		expired: 0,
		creditsWrittenOff: 0,
		ptSessionsWrittenOff: 0,
		errors: 0,
	};

	const lapsed = await Membership.find({
		status: MembershipStatus.Active,
		endDate: { $ne: null, $lt: now },
	}).select(
		"_id user creditsRemaining ptSessionsRemaining endDate planName locationId",
	);

	summary.scanned = lapsed.length;

	for (const membership of lapsed) {
		const creditsLeft = Number(membership.creditsRemaining ?? 0);
		const ptLeft = Number(membership.ptSessionsRemaining ?? 0);

		if (dryRun) {
			summary.expired += 1;
			summary.creditsWrittenOff += creditsLeft;
			summary.ptSessionsWrittenOff += ptLeft;
			console.info(
				`[MEMBERSHIP_EXPIRY][DRY_RUN] would expire ${membership._id} "${membership.planName}" — ${creditsLeft} credits, ${ptLeft} PT sessions written off`,
			);
			continue;
		}

		try {
			await executeInTransaction(async (session) => {
				// Guard on status inside the transaction so two concurrent job
				// runs can't both claim the same membership.
				const claimed = await Membership.findOneAndUpdate(
					{ _id: membership._id, status: MembershipStatus.Active },
					{
						$set: {
							status: MembershipStatus.Expired,
							creditsRemaining: 0,
							ptSessionsRemaining: 0,
						},
					},
					{ new: true, session },
				);

				if (!claimed) {
					return;
				}

				const writeOffs: Record<string, unknown>[] = [];

				if (creditsLeft > 0) {
					writeOffs.push({
						user: membership.user,
						membership: membership._id,
						amount: -creditsLeft,
						type: CreditTransactionType.Void,
						sourceType: CreditTransactionSource.Expiry,
						sourceId: membership._id,
						actorRole: "system",
						locationId: membership.locationId ?? null,
						reason: `${creditsLeft} credits lapsed when "${membership.planName}" expired on ${membership.endDate?.toISOString().slice(0, 10)}`,
					});
				}

				if (ptLeft > 0) {
					writeOffs.push({
						user: membership.user,
						membership: membership._id,
						amount: -ptLeft,
						type: CreditTransactionType.Void,
						sourceType: CreditTransactionSource.Expiry,
						sourceId: membership._id,
						actorRole: "system",
						locationId: membership.locationId ?? null,
						reason: `${ptLeft} PT sessions lapsed when "${membership.planName}" expired on ${membership.endDate?.toISOString().slice(0, 10)}`,
					});
				}

				if (writeOffs.length > 0) {
					await CreditTransaction.create(writeOffs, { session });
				}

				summary.expired += 1;
				summary.creditsWrittenOff += creditsLeft;
				summary.ptSessionsWrittenOff += ptLeft;
			});
		} catch (error) {
			summary.errors += 1;
			console.error("[MEMBERSHIP_EXPIRY] Failed to expire membership", {
				membershipId: membership._id.toString(),
				error,
			});
		}
	}

	if (summary.expired > 0 || summary.errors > 0) {
		console.info(
			`[MEMBERSHIP_EXPIRY]${dryRun ? "[DRY_RUN]" : ""} Run complete`,
			summary,
		);
	}

	return summary;
};

/**
 * Freeze a membership. Access stops immediately (the active-membership filter
 * excludes Paused); the clock is credited back on resume, not here — we can't
 * know the freeze length until it ends.
 */
export const pauseMembership = async (params: {
	membershipId: string;
	actorId?: string;
	actorRole?: string;
	reason?: string;
	now?: Date;
}) => {
	const now = params.now || new Date();

	if (!mongoose.Types.ObjectId.isValid(params.membershipId)) {
		throw new MembershipLifecycleError(
			"INVALID_ARGUMENT",
			"Invalid membership id",
		);
	}

	const membership = await Membership.findById(params.membershipId);
	if (!membership) {
		throw new MembershipLifecycleError("NOT_FOUND", "Membership not found");
	}

	if (membership.status !== MembershipStatus.Active) {
		throw new MembershipLifecycleError(
			"INVALID_STATE",
			`Only an active membership can be paused (this one is ${membership.status})`,
		);
	}

	const { settings } = await getLocationSettings(membership.locationId);
	const cap = Number(settings?.pauseMaxDaysPerTerm ?? 30);
	const alreadyUsed = Number(membership.totalPausedDays ?? 0);

	if (cap > 0 && alreadyUsed >= cap) {
		throw new MembershipLifecycleError(
			"PAUSE_LIMIT_REACHED",
			`This membership has already used its ${cap}-day freeze allowance for the term`,
		);
	}

	const updated = await Membership.findOneAndUpdate(
		{ _id: membership._id, status: MembershipStatus.Active },
		{
			$set: { status: MembershipStatus.Paused },
			$push: {
				pauseIntervals: {
					pausedAt: now,
					resumedAt: null,
					days: 0,
					pausedBy: params.actorId
						? new mongoose.Types.ObjectId(params.actorId)
						: null,
					reason: params.reason || "",
				},
			},
		},
		{ new: true },
	);

	if (!updated) {
		throw new MembershipLifecycleError(
			"INVALID_STATE",
			"Membership was modified concurrently; try again",
		);
	}

	return {
		membership: updated,
		pausedAt: now,
		daysRemainingInAllowance: cap > 0 ? Math.max(0, cap - alreadyUsed) : null,
	};
};

/**
 * Resume a frozen membership and push endDate out by the days lost.
 *
 * The credited days are clamped to whatever is left of the location's
 * per-term allowance, so an indefinite freeze can't extend a membership
 * forever.
 */
export const resumeMembership = async (params: {
	membershipId: string;
	actorId?: string;
	actorRole?: string;
	now?: Date;
}) => {
	const now = params.now || new Date();

	if (!mongoose.Types.ObjectId.isValid(params.membershipId)) {
		throw new MembershipLifecycleError(
			"INVALID_ARGUMENT",
			"Invalid membership id",
		);
	}

	const membership = await Membership.findById(params.membershipId);
	if (!membership) {
		throw new MembershipLifecycleError("NOT_FOUND", "Membership not found");
	}

	if (membership.status !== MembershipStatus.Paused) {
		throw new MembershipLifecycleError(
			"INVALID_STATE",
			`Only a paused membership can be resumed (this one is ${membership.status})`,
		);
	}

	const intervals = (membership.pauseIntervals ?? []) as Array<{
		pausedAt: Date;
		resumedAt: Date | null;
		days: number;
	}>;

	const openIndex = intervals.findIndex((i) => !i.resumedAt);
	if (openIndex === -1) {
		throw new MembershipLifecycleError(
			"INVALID_STATE",
			"Membership is paused but has no open pause interval to close",
		);
	}

	const openInterval = intervals[openIndex];
	const pausedAt = new Date(openInterval!.pausedAt);

	// Round up: any part-day of freeze is credited back in the member's favour.
	const rawDays = Math.max(
		0,
		Math.ceil((now.getTime() - pausedAt.getTime()) / DAY_MS),
	);

	const { settings } = await getLocationSettings(membership.locationId);
	const cap = Number(settings?.pauseMaxDaysPerTerm ?? 30);
	const alreadyUsed = Number(membership.totalPausedDays ?? 0);
	const creditableDays =
		cap > 0 ? Math.max(0, Math.min(rawDays, cap - alreadyUsed)) : rawDays;

	const currentEnd = membership.endDate ? new Date(membership.endDate) : null;
	const newEnd = currentEnd
		? new Date(currentEnd.getTime() + creditableDays * DAY_MS)
		: null;

	const setOps: Record<string, unknown> = {
		status: MembershipStatus.Active,
		[`pauseIntervals.${openIndex}.resumedAt`]: now,
		[`pauseIntervals.${openIndex}.days`]: creditableDays,
	};

	// An open-ended membership (no endDate) has nothing to extend.
	if (newEnd) {
		setOps.endDate = newEnd;
	}

	const updated = await Membership.findOneAndUpdate(
		{ _id: membership._id, status: MembershipStatus.Paused },
		{
			$set: setOps,
			$inc: { totalPausedDays: creditableDays },
		},
		{ new: true },
	);

	if (!updated) {
		throw new MembershipLifecycleError(
			"INVALID_STATE",
			"Membership was modified concurrently; try again",
		);
	}

	return {
		membership: updated,
		pausedDays: rawDays,
		creditedDays: creditableDays,
		// Surfaced so the desk can explain a shortfall to the member.
		cappedBy: creditableDays < rawDays ? cap : null,
		previousEndDate: currentEnd,
		newEndDate: newEnd,
	};
};
