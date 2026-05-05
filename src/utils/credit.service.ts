import mongoose from "mongoose";
import CreditTransaction from "../models/CreditTransaction";
import {
	CreditTransactionSource,
	CreditTransactionType,
	MembershipStatus,
} from "../models/Enums";
import Membership from "../models/Membership";

type ActorRole = "admin" | "user" | "doctor" | "trainer";

const toObjectId = (
	value: string,
	code: CreditServiceErrorCode,
	message: string,
): mongoose.Types.ObjectId => {
	if (!mongoose.Types.ObjectId.isValid(value)) {
		throw new CreditServiceError(code, message);
	}

	return new mongoose.Types.ObjectId(value);
};

const toOptionalObjectId = (
	value: string | undefined,
): mongoose.Types.ObjectId | undefined => {
	if (!value) {
		return undefined;
	}

	if (!mongoose.Types.ObjectId.isValid(value)) {
		return undefined;
	}

	return new mongoose.Types.ObjectId(value);
};

const buildActiveMembershipFilter = (
	userId: mongoose.Types.ObjectId,
	now: Date,
): Record<string, unknown> => ({
	user: userId,
	status: MembershipStatus.Active,
	startDate: { $lte: now },
	$or: [
		{ endDate: { $exists: false } },
		{ endDate: null },
		{ endDate: { $gte: now } },
	],
});

type MembershipBalanceSnapshot = {
	_id: mongoose.Types.ObjectId;
	creditsRemaining: number;
	endDate?: Date | null;
	createdAt?: Date | null;
};

const sortMembershipsByExpiry = (memberships: MembershipBalanceSnapshot[]) => {
	const maxDate = Number.MAX_SAFE_INTEGER;

	return memberships.sort((a, b) => {
		const aEnd = a.endDate ? new Date(a.endDate).getTime() : maxDate;
		const bEnd = b.endDate ? new Date(b.endDate).getTime() : maxDate;
		if (aEnd !== bEnd) {
			return aEnd - bEnd;
		}

		const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
		const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
		return aCreated - bCreated;
	});
};

export type CreditServiceErrorCode =
	| "INVALID_ARGUMENT"
	| "NO_ACTIVE_MEMBERSHIP"
	| "INSUFFICIENT_CREDITS";

export class CreditServiceError extends Error {
	public readonly code: CreditServiceErrorCode;

	constructor(code: CreditServiceErrorCode, message: string) {
		super(message);
		this.name = "CreditServiceError";
		this.code = code;
	}
}

type CreditContext = {
	actorId?: string;
	actorRole?: ActorRole;
	reason?: string;
	metadata?: Record<string, unknown>;
};

export const getUserCreditBalance = async (userId: string) => {
	const userObjectId = toObjectId(
		userId,
		"INVALID_ARGUMENT",
		"Invalid user id",
	);
	const now = new Date();
	const baseFilter = buildActiveMembershipFilter(userObjectId, now);
	const memberships = await Membership.find(baseFilter)
		.select("_id planName creditsIncluded creditsRemaining endDate")
		.sort({ endDate: 1, createdAt: 1 });

	let totalIncluded = 0;
	let totalRemaining = 0;
	for (const membership of memberships) {
		totalIncluded += Number(membership.creditsIncluded ?? 0);
		totalRemaining += Number(membership.creditsRemaining ?? 0);
	}

	return {
		userId,
		totalIncluded,
		totalRemaining,
		memberships: memberships.map((membership) => ({
			id: membership._id.toString(),
			planName: membership.planName,
			creditsIncluded: Number(membership.creditsIncluded ?? 0),
			creditsRemaining: Number(membership.creditsRemaining ?? 0),
			endDate: membership.endDate,
		})),
	};
};

export const consumeCredits = async (
	input: {
		userId: string;
		amount: number;
		sourceType: CreditTransactionSource;
		sourceId?: string;
	} & CreditContext,
) => {
	if (!Number.isFinite(input.amount) || input.amount <= 0) {
		throw new CreditServiceError(
			"INVALID_ARGUMENT",
			"Credit amount must be a positive number",
		);
	}

	const userObjectId = toObjectId(
		input.userId,
		"INVALID_ARGUMENT",
		"Invalid user id",
	);
	const now = new Date();
	const baseFilter = buildActiveMembershipFilter(userObjectId, now);

	const hasActiveMembership = await Membership.exists(baseFilter);
	if (!hasActiveMembership) {
		throw new CreditServiceError(
			"NO_ACTIVE_MEMBERSHIP",
			"User has no active membership",
		);
	}

	const memberships = sortMembershipsByExpiry(
		await Membership.find({
			...baseFilter,
			creditsRemaining: { $gt: 0 },
		})
			.select("_id creditsRemaining endDate createdAt")
			.lean(),
	);

	const availableCredits = memberships.reduce(
		(total, membership) => total + Number(membership.creditsRemaining ?? 0),
		0,
	);
	if (availableCredits < input.amount) {
		throw new CreditServiceError(
			"INSUFFICIENT_CREDITS",
			"Insufficient credits",
		);
	}

	let remaining = input.amount;
	const allocations: Array<{
		membershipId: mongoose.Types.ObjectId;
		amount: number;
	}> = [];

	for (const membership of memberships) {
		if (remaining <= 0) {
			break;
		}

		const candidateAmount = Math.min(
			remaining,
			Number(membership.creditsRemaining ?? 0),
		);
		if (candidateAmount <= 0) {
			continue;
		}

		const consumedMembership = await Membership.findOneAndUpdate(
			{
				_id: membership._id,
				...baseFilter,
				creditsRemaining: { $gte: candidateAmount },
			},
			{ $inc: { creditsRemaining: -candidateAmount } },
			{ returnDocument: "after" },
		);

		if (!consumedMembership) {
			continue;
		}

		allocations.push({
			membershipId: consumedMembership._id,
			amount: candidateAmount,
		});
		remaining -= candidateAmount;
	}

	if (remaining > 0) {
		await Promise.all(
			allocations.map((allocation) =>
				Membership.findByIdAndUpdate(allocation.membershipId, {
					$inc: { creditsRemaining: allocation.amount },
				}),
			),
		);
		throw new CreditServiceError(
			"INSUFFICIENT_CREDITS",
			"Insufficient credits due to concurrent booking operations",
		);
	}

	const sourceId = toOptionalObjectId(input.sourceId);
	const actorId = toOptionalObjectId(input.actorId);

	try {
		await CreditTransaction.insertMany(
			allocations.map((allocation) => ({
				user: userObjectId,
				membership: allocation.membershipId,
				amount: -allocation.amount,
				type: CreditTransactionType.Consume,
				sourceType: input.sourceType,
				...(sourceId ? { sourceId } : {}),
				...(input.reason ? { reason: input.reason } : {}),
				...(actorId ? { actorId } : {}),
				...(input.actorRole ? { actorRole: input.actorRole } : {}),
				...(input.metadata ? { metadata: input.metadata } : {}),
			})),
		);
	} catch (error) {
		await Promise.all(
			allocations.map((allocation) =>
				Membership.findByIdAndUpdate(allocation.membershipId, {
					$inc: { creditsRemaining: allocation.amount },
				}),
			),
		);
		throw error;
	}

	return {
		consumed: input.amount,
		allocations: allocations.map((allocation) => ({
			membershipId: allocation.membershipId.toString(),
			amount: allocation.amount,
		})),
	};
};

export const refundCreditsBySource = async (
	input: {
		userId: string;
		sourceType: CreditTransactionSource;
		sourceId: string;
		session?: mongoose.ClientSession;
	} & CreditContext,
) => {
	const userObjectId = toObjectId(
		input.userId,
		"INVALID_ARGUMENT",
		"Invalid user id",
	);
	const sourceObjectId = toObjectId(
		input.sourceId,
		"INVALID_ARGUMENT",
		"Invalid source id",
	);
	const actorId = toOptionalObjectId(input.actorId);

	const historyQuery = CreditTransaction.find({
		user: userObjectId,
		sourceType: input.sourceType,
		sourceId: sourceObjectId,
	})
		.select("membership amount type")
		.sort({ createdAt: 1 });

	if (input.session) {
		historyQuery.session(input.session);
	}

	const history = await historyQuery;

	if (history.length === 0) {
		return { refunded: 0, alreadyRefunded: true };
	}

	const consumedByMembership = new Map<string, number>();
	const refundedByMembership = new Map<string, number>();

	for (const entry of history) {
		const membershipId = entry.membership.toString();
		if (entry.type === CreditTransactionType.Consume) {
			consumedByMembership.set(
				membershipId,
				(consumedByMembership.get(membershipId) ?? 0) +
					Math.abs(Number(entry.amount)),
			);
		}

		if (entry.type === CreditTransactionType.Refund) {
			refundedByMembership.set(
				membershipId,
				(refundedByMembership.get(membershipId) ?? 0) + Number(entry.amount),
			);
		}
	}

	const pendingRefunds: Array<{ membershipId: string; amount: number }> = [];
	for (const [membershipId, consumed] of consumedByMembership.entries()) {
		const refunded = refundedByMembership.get(membershipId) ?? 0;
		const pending = consumed - refunded;
		if (pending > 0) {
			pendingRefunds.push({ membershipId, amount: pending });
		}
	}

	if (pendingRefunds.length === 0) {
		return { refunded: 0, alreadyRefunded: true };
	}

	for (const pendingRefund of pendingRefunds) {
		await Membership.findByIdAndUpdate(
			pendingRefund.membershipId,
			{ $inc: { creditsRemaining: pendingRefund.amount } },
			{ ...(input.session ? { session: input.session } : {}) },
		);
	}

	const insertOptions = input.session ? { session: input.session } : undefined;

	await CreditTransaction.insertMany(
		pendingRefunds.map((pendingRefund) => ({
			user: userObjectId,
			membership: pendingRefund.membershipId,
			amount: pendingRefund.amount,
			type: CreditTransactionType.Refund,
			sourceType: input.sourceType,
			sourceId: sourceObjectId,
			...(input.reason ? { reason: input.reason } : {}),
			...(actorId ? { actorId } : {}),
			...(input.actorRole ? { actorRole: input.actorRole } : {}),
			...(input.metadata ? { metadata: input.metadata } : {}),
		})),
		insertOptions,
	);

	return {
		refunded: pendingRefunds.reduce((total, entry) => total + entry.amount, 0),
		alreadyRefunded: false,
	};
};

export const addCreditsToMembership = async (
	input: {
		userId: string;
		amount: number;
		membershipId?: string;
	} & CreditContext,
) => {
	if (!Number.isFinite(input.amount) || input.amount <= 0) {
		throw new CreditServiceError(
			"INVALID_ARGUMENT",
			"Top-up amount must be a positive number",
		);
	}

	const userObjectId = toObjectId(
		input.userId,
		"INVALID_ARGUMENT",
		"Invalid user id",
	);
	const now = new Date();
	const baseFilter = buildActiveMembershipFilter(userObjectId, now);
	const explicitMembershipId = input.membershipId
		? toObjectId(
				input.membershipId,
				"INVALID_ARGUMENT",
				"Invalid membership id",
			)
		: undefined;
	const actorId = toOptionalObjectId(input.actorId);

	const targetMembership = explicitMembershipId
		? await Membership.findOne({
				_id: explicitMembershipId,
				user: userObjectId,
			}).select("_id")
		: await Membership.findOne(baseFilter)
				.select("_id")
				.sort({ endDate: 1, createdAt: 1 });

	if (!targetMembership) {
		if (explicitMembershipId) {
			throw new CreditServiceError(
				"NO_ACTIVE_MEMBERSHIP",
				"Provided membershipId was not found for the target user",
			);
		}

		const upcomingMembership = await Membership.findOne({
			user: userObjectId,
			status: MembershipStatus.Active,
			startDate: { $gt: now },
		})
			.select("startDate")
			.sort({ startDate: 1, createdAt: 1 })
			.lean();

		if (upcomingMembership?.startDate) {
			throw new CreditServiceError(
				"NO_ACTIVE_MEMBERSHIP",
				`User has no active membership yet. Next membership starts at ${new Date(upcomingMembership.startDate).toISOString()}`,
			);
		}

		throw new CreditServiceError(
			"NO_ACTIVE_MEMBERSHIP",
			"User has no active membership in the current date window (status Active, startDate <= now, and endDate is missing or >= now)",
		);
	}

	const membership = await Membership.findByIdAndUpdate(
		targetMembership._id,
		{ $inc: { creditsRemaining: input.amount } },
		{ returnDocument: "after", runValidators: true },
	);

	if (!membership) {
		throw new CreditServiceError(
			"NO_ACTIVE_MEMBERSHIP",
			"Membership not found",
		);
	}

	await CreditTransaction.create({
		user: userObjectId,
		membership: membership._id,
		amount: input.amount,
		type: CreditTransactionType.AdminTopUp,
		sourceType: CreditTransactionSource.Admin,
		sourceId: membership._id,
		...(input.reason ? { reason: input.reason } : {}),
		...(actorId ? { actorId } : {}),
		...(input.actorRole ? { actorRole: input.actorRole } : {}),
		...(input.metadata ? { metadata: input.metadata } : {}),
	});

	return {
		membershipId: membership._id.toString(),
		toppedUp: input.amount,
		creditsRemaining: Number(membership.creditsRemaining ?? 0),
	};
};

export const getUserCreditHistory = async (input: {
	userId: string;
	limit?: number;
	sourceType?: CreditTransactionSource;
}) => {
	const userObjectId = toObjectId(
		input.userId,
		"INVALID_ARGUMENT",
		"Invalid user id",
	);
	const limit =
		typeof input.limit === "number" && input.limit > 0
			? Math.min(Math.floor(input.limit), 200)
			: 50;

	const transactions = await CreditTransaction.find({
		user: userObjectId,
		...(input.sourceType ? { sourceType: input.sourceType } : {}),
	})
		.sort({ createdAt: -1 })
		.limit(limit)
		.select(
			"membership amount type sourceType sourceId reason actorId actorRole createdAt",
		);

	return {
		userId: input.userId,
		count: transactions.length,
		transactions: transactions.map((transaction) => ({
			id: transaction._id.toString(),
			membershipId: transaction.membership.toString(),
			amount: Number(transaction.amount),
			type: transaction.type,
			sourceType: transaction.sourceType,
			sourceId: transaction.sourceId ? transaction.sourceId.toString() : null,
			reason: transaction.reason,
			actorId: transaction.actorId ? transaction.actorId.toString() : null,
			actorRole: transaction.actorRole ?? null,
			createdAt: transaction.createdAt,
		})),
	};
};
