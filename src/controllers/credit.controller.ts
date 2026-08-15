import type { RequestHandler } from "express";
import mongoose from "mongoose";
import type { CreditTransactionSource } from "../models/Enums";
import {
	addCreditsToMembership,
	CreditServiceError,
	getUserCreditBalance,
	getUserCreditHistory,
	mapCreditServiceError,
} from "../utils/credit.service";
import {
	creditHistoryQuerySchema,
	topUpCreditsBodySchema,
} from "../validators/credit.validator";
import {
	GraceGrantError,
	grantGraceEntitlement,
	mapGraceGrantError,
} from "../services/grace-grant.service";
import { normalizeRole } from "../middleware/rbac.middleware";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

export const getMyCreditBalance: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ message: "Only users can access this endpoint" });
		return;
	}

	try {
		const balance = await getUserCreditBalance(req.user.id);
		res.status(200).json(balance);
	} catch (error) {
		next(error);
	}
};

export const getCreditsBalance: RequestHandler = async (req, res, next) => {
	const userId = (req.user as any)?.id || (req.user as any)?.userId;
	if (!userId) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		const balance = await getUserCreditBalance(userId);
		res.status(200).json(balance);
	} catch (error) {
		next(error);
	}
};

export const getCreditsLedger: RequestHandler = async (req, res, next) => {
	const userId = (req.user as any)?.id || (req.user as any)?.userId;
	if (!userId) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const parsedQuery = creditHistoryQuerySchema.safeParse(req.query);
	if (!parsedQuery.success) {
		res.status(400).json({
			message: "Invalid credit history query",
			errors: parsedQuery.error.issues,
		});
		return;
	}

	try {
		const history = await getUserCreditHistory({
			userId,
			limit: parsedQuery.data.limit,
			sourceType: parsedQuery.data.sourceType as CreditTransactionSource,
		});
		res.status(200).json(history);
	} catch (error) {
		next(error);
	}
};

export const getMyCreditHistory: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ message: "Only users can access this endpoint" });
		return;
	}

	const parsedQuery = creditHistoryQuerySchema.safeParse(req.query);
	if (!parsedQuery.success) {
		res.status(400).json({
			message: "Invalid credit history query",
			errors: parsedQuery.error.issues,
		});
		return;
	}

	try {
		const history = await getUserCreditHistory({
			userId: req.user.id,
			limit: parsedQuery.data.limit,
			sourceType: parsedQuery.data.sourceType as CreditTransactionSource,
		});
		res.status(200).json(history);
	} catch (error) {
		next(error);
	}
};

export const getUserCreditBalanceById: RequestHandler = async (
	req,
	res,
	next,
) => {
	const userId = getIdParam(req.params.userId);
	if (!userId) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	if (req.user?.role === "user" && req.user.id !== userId) {
		res.status(403).json({ message: "Forbidden" });
		return;
	}

	try {
		const balance = await getUserCreditBalance(userId);
		res.status(200).json(balance);
	} catch (error) {
		next(error);
	}
};

export const getUserCreditHistoryById: RequestHandler = async (
	req,
	res,
	next,
) => {
	const userId = getIdParam(req.params.userId);
	if (!userId) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	if (req.user?.role === "user" && req.user.id !== userId) {
		res.status(403).json({ message: "Forbidden" });
		return;
	}

	const parsedQuery = creditHistoryQuerySchema.safeParse(req.query);
	if (!parsedQuery.success) {
		res.status(400).json({
			message: "Invalid credit history query",
			errors: parsedQuery.error.issues,
		});
		return;
	}

	try {
		const history = await getUserCreditHistory({
			userId,
			limit: parsedQuery.data.limit,
			sourceType: parsedQuery.data.sourceType as CreditTransactionSource,
		});
		res.status(200).json(history);
	} catch (error) {
		next(error);
	}
};

export const topUpUserCreditsById: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);
	if (!userId) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	if (!req.user || req.user.role !== "admin") {
		res.status(403).json({ message: "Only admins can top up credits" });
		return;
	}

	const parsedBody = topUpCreditsBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid top-up payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const topUpContext = {
		userId,
		membershipId: parsedBody.data.membershipId ?? null,
		amount: parsedBody.data.amount,
		actorId: req.user.id,
		actorRole: req.user.role,
	};

	console.info("[CREDITS_TOPUP_ATTEMPT]", topUpContext);

	try {
		const result = await addCreditsToMembership({
			userId,
			membershipId: parsedBody.data.membershipId,
			amount: parsedBody.data.amount,
			reason: parsedBody.data.reason ?? "Admin credit top-up",
			actorId: req.user.id,
			actorRole: req.user.role,
		});
		console.info("[CREDITS_TOPUP_SUCCESS]", {
			...topUpContext,
			appliedMembershipId: result.membershipId,
			creditsRemaining: result.creditsRemaining,
		});
		res.status(200).json({ message: "Credits topped up", ...result });
	} catch (error) {
		if (error instanceof CreditServiceError) {
			console.warn("[CREDITS_TOPUP_FAILED]", {
				...topUpContext,
				errorCode: error.code,
				errorMessage: error.message,
			});

			const creditError = mapCreditServiceError(error);
			res.status(creditError.status).json({
				message: creditError.message,
				code: error.code,
				details: {
					...topUpContext,
					hint: parsedBody.data.membershipId
						? "Ensure membershipId belongs to the target user"
						: "Provide membershipId or ensure user has an active membership in the current date window",
				},
			});
			return;
		}

		next(error);
	}
};

/**
 * Admin / front-desk grace grant.
 *
 * Distinct from the top-up endpoint above: a top-up adds credits to an
 * existing purchased membership, whereas a grant issues its own zero-price
 * membership with an independent expiry, so comped value stays separable from
 * revenue and can lapse on its own schedule.
 */
export const grantGraceToUserById: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);
	if (!userId) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	if (!req.user) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		const result = await grantGraceEntitlement({
			userId,
			type: req.body?.type,
			amount: req.body?.amount,
			reason: req.body?.reason,
			expiryDays: req.body?.expiryDays,
			locationId:
				typeof req.body?.locationId === "string"
					? req.body.locationId
					: undefined,
			actorId: req.user.id,
			actorRole: normalizeRole(req.user.role),
		});

		console.info("[GRACE_GRANT_SUCCESS]", {
			userId,
			type: result.type,
			amount: result.amount,
			actorId: req.user.id,
			actorRole: req.user.role,
			locationId: String(result.locationId),
		});

		res.status(201).json({
			message: `Granted ${result.amount} ${
				result.type === "CREDIT" ? "credits" : "PT sessions"
			}, expiring ${result.expiresAt.toISOString().slice(0, 10)}`,
			grant: {
				membershipId: result.membership._id.toString(),
				type: result.type,
				amount: result.amount,
				expiresAt: result.expiresAt,
				locationId: String(result.locationId),
			},
		});
	} catch (error) {
		if (error instanceof GraceGrantError) {
			const mapped = mapGraceGrantError(error);
			console.warn("[GRACE_GRANT_REJECTED]", {
				userId,
				actorId: req.user.id,
				code: mapped.code,
			});
			res
				.status(mapped.status)
				.json({ message: mapped.message, code: mapped.code });
			return;
		}
		next(error);
	}
};
