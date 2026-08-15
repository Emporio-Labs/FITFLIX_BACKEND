import mongoose from "mongoose";
import {
	CreditTransactionSource,
	CreditTransactionType,
	MembershipStatus,
} from "../models/Enums";
import CreditTransaction from "../models/CreditTransaction";
import Membership from "../models/Membership";
import User from "../models/User";
import { getLocationSettings } from "../utils/location.resolver";
import { executeInTransaction } from "../utils/transaction.util";

/**
 * Admin / front-desk grace grants.
 *
 * A grant is issued as its own zero-price membership rather than as an
 * increment on something the member already paid for. That keeps comped value
 * separable from revenue, gives the grant an independent expiry, and matches
 * the shape the entitlement engine will generalise later ("grants are just
 * packages with a price of zero").
 *
 * Credits granted this way pool with purchased credits automatically, because
 * consumeCredits allocates across every active membership oldest-expiry-first.
 */

export const GRANTABLE_TYPES = ["CREDIT", "PT_SESSION"] as const;
export type GrantableType = (typeof GRANTABLE_TYPES)[number];

/** Roles the CreditTransaction ledger accepts as an actor. */
const LEDGER_ACTOR_ROLES = [
	"admin",
	"user",
	"doctor",
	"trainer",
	"nutritionist",
	"frontdesk",
	"system",
] as const;
type LedgerActorRole = (typeof LEDGER_ACTOR_ROLES)[number];

const toLedgerActorRole = (
	role: string | undefined,
): LedgerActorRole | undefined =>
	LEDGER_ACTOR_ROLES.includes(role as LedgerActorRole)
		? (role as LedgerActorRole)
		: undefined;

export class GraceGrantError extends Error {
	code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "GraceGrantError";
		this.code = code;
	}
}

export const mapGraceGrantError = (
	error: GraceGrantError,
): { status: number; message: string; code: string } => {
	switch (error.code) {
		case "USER_NOT_FOUND":
			return { status: 404, message: error.message, code: error.code };
		case "GRANT_LIMIT_EXCEEDED":
		case "MONTHLY_LIMIT_EXCEEDED":
			return { status: 409, message: error.message, code: error.code };
		default:
			return { status: 400, message: error.message, code: error.code };
	}
};

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfMonth = (now: Date) =>
	new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

/**
 * Total already granted by this actor in the current calendar month.
 * Grant rows are positive AdminTopUp entries sourced from Admin.
 */
const sumGrantsThisMonth = async (
	actorId: mongoose.Types.ObjectId,
	now: Date,
): Promise<number> => {
	const result = await CreditTransaction.aggregate<{ total: number }>([
		{
			$match: {
				actorId,
				type: CreditTransactionType.AdminTopUp,
				sourceType: CreditTransactionSource.Admin,
				createdAt: { $gte: startOfMonth(now) },
			},
		},
		{ $group: { _id: null, total: { $sum: "$amount" } } },
	]);

	return Number(result[0]?.total ?? 0);
};

export type GrantGraceInput = {
	userId: string;
	type: GrantableType;
	amount: number;
	reason: string;
	expiryDays?: number;
	locationId?: string;
	actorId?: string;
	actorRole?: string;
};

export const grantGraceEntitlement = async (input: GrantGraceInput) => {
	const now = new Date();

	if (!mongoose.Types.ObjectId.isValid(input.userId)) {
		throw new GraceGrantError("INVALID_ARGUMENT", "Invalid user id");
	}

	if (!GRANTABLE_TYPES.includes(input.type)) {
		throw new GraceGrantError(
			"INVALID_ARGUMENT",
			`type must be one of: ${GRANTABLE_TYPES.join(", ")}`,
		);
	}

	const amount = Number(input.amount);
	if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
		throw new GraceGrantError(
			"INVALID_ARGUMENT",
			"amount must be a positive whole number",
		);
	}

	// A grant with no stated reason is unauditable, which defeats the point.
	if (!input.reason || !input.reason.trim()) {
		throw new GraceGrantError(
			"INVALID_ARGUMENT",
			"reason is required so the grant can be audited",
		);
	}

	const userObjId = new mongoose.Types.ObjectId(input.userId);
	const user = await User.findById(userObjId).select(
		"_id homeLocationId assignedTrainer",
	);
	if (!user) {
		throw new GraceGrantError("USER_NOT_FOUND", "Member not found");
	}

	// Grant is attributed to the caller's branch, falling back to the member's
	// home club, then to the sole active location.
	const { locationId, settings } = await getLocationSettings(
		input.locationId ??
			(user as { homeLocationId?: mongoose.Types.ObjectId }).homeLocationId ??
			null,
	);

	const limits = settings?.graceGrantLimits;
	const actorObjId =
		input.actorId && mongoose.Types.ObjectId.isValid(input.actorId)
			? new mongoose.Types.ObjectId(input.actorId)
			: null;

	// Caps apply to frontdesk only; admins are uncapped by design.
	const isCapped = input.actorRole === "frontdesk";
	if (isCapped) {
		const maxPerGrant = Number(limits?.frontdeskMaxPerGrant ?? 5);
		if (amount > maxPerGrant) {
			throw new GraceGrantError(
				"GRANT_LIMIT_EXCEEDED",
				`Front desk grants are limited to ${maxPerGrant} per grant. Ask an admin for anything larger.`,
			);
		}

		const maxPerMonth = Number(limits?.frontdeskMaxPerMonth ?? 20);
		if (actorObjId) {
			const alreadyGranted = await sumGrantsThisMonth(actorObjId, now);
			if (alreadyGranted + amount > maxPerMonth) {
				throw new GraceGrantError(
					"MONTHLY_LIMIT_EXCEEDED",
					`This would exceed your ${maxPerMonth}-per-month grant allowance (${alreadyGranted} already granted this month).`,
				);
			}
		}
	}

	const expiryDays = Number(
		input.expiryDays ?? limits?.defaultExpiryDays ?? 30,
	);
	if (!Number.isFinite(expiryDays) || expiryDays <= 0) {
		throw new GraceGrantError(
			"INVALID_ARGUMENT",
			"expiryDays must be a positive number",
		);
	}

	const endDate = new Date(now.getTime() + expiryDays * DAY_MS);
	const isCredit = input.type === "CREDIT";

	// A PT grant should honour whatever coach the member is already assigned
	// (via the admin "Assigned Personal Trainer" screen) rather than issuing a
	// package the mobile app treats as unassigned and reopens the trainer
	// picker for. Credits carry no trainer, so this only applies to PT grants.
	const inheritedTrainerId =
		!isCredit && (user as { assignedTrainer?: mongoose.Types.ObjectId })
			.assignedTrainer
			? (user as { assignedTrainer?: mongoose.Types.ObjectId })
					.assignedTrainer
			: null;

	return executeInTransaction(async (session) => {
		const created = await Membership.create(
			[
				{
					user: userObjId,
					planName: isCredit
						? `Grace Credits (${amount})`
						: `Grace PT Sessions (${amount})`,
					category: isCredit ? "CREDIT_PACK" : "PERSONAL_TRAINING",
					creditsIncluded: isCredit ? amount : 0,
					creditsRemaining: isCredit ? amount : 0,
					ptSessionsIncluded: isCredit ? 0 : amount,
					ptSessionsRemaining: isCredit ? 0 : amount,
					ptSessionsUsed: 0,
					status: MembershipStatus.Active,
					price: 0,
					currency: settings?.currency || "INR",
					startDate: now,
					endDate,
					locationId,
					assignedTrainerId: inheritedTrainerId,
					source: "GRANT",
					grantedBy: actorObjId,
					grantReason: input.reason.trim(),
					notes: `Grace grant by ${input.actorRole ?? "staff"}: ${input.reason.trim()}`,
				},
			],
			{ session },
		);

		const membership = created[0];
		if (!membership) {
			throw new GraceGrantError(
				"GRANT_FAILED",
				"Could not create the grant membership",
			);
		}

		await CreditTransaction.create(
			[
				{
					user: userObjId,
					membership: membership._id,
					amount,
					type: CreditTransactionType.AdminTopUp,
					sourceType: CreditTransactionSource.Admin,
					sourceId: membership._id,
					actorId: actorObjId ?? undefined,
					actorRole: toLedgerActorRole(input.actorRole),
					locationId,
					reason: `Grace grant (${input.type}): ${input.reason.trim()}`,
					metadata: {
						grantType: input.type,
						expiryDays,
						expiresAt: endDate.toISOString(),
					},
				},
			],
			{ session },
		);

		return {
			membership,
			type: input.type,
			amount,
			expiresAt: endDate,
			locationId,
		};
	});
};
