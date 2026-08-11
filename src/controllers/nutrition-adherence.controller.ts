import type { RequestHandler } from "express";
import UserNutritionPlan from "../models/nutrition-plan.model";
import {
	getAdherenceRange,
	getPlanAdherenceSummary,
	getWeeklyAdherence,
	rebuildAdherence,
	rebuildUserAdherence,
	recomputeDay,
} from "../services/nutrition/nutrition-adherence.service";
import { getPlan } from "../services/nutrition/nutrition-assignment.service";
import {
	getValidationDetails,
	handleNutritionError,
	normalizeToUtcDate,
	NutritionServiceError,
	requireIdParam,
} from "../services/nutrition/nutrition-errors";
import {
	adherenceRangeQuerySchema,
	planAdherenceQuerySchema,
	rebuildAdherenceBodySchema,
} from "../validators/nutrition-meal-log.validator";

export const getMyAdherence: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = adherenceRangeQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const isStaff = ["nutritionist", "admin"].includes(requester.role);
		const targetUserId =
			isStaff && parsed.data.userId ? parsed.data.userId : requester.id;

		// planId "none" forces the plan-less rollup even when a plan exists —
		// undefined falls back to auto-resolving the latest plan (legacy
		// default). Without this distinction, a user with any plan on record
		// (even an old/inactive one) would silently get that plan's rollup
		// instead of the plan-less one their free-form diary logs into.
		let planId: string | null;
		if (parsed.data.planId === "none") {
			planId = null;
		} else if (parsed.data.planId) {
			planId = parsed.data.planId;
		} else {
			const latestPlan = await UserNutritionPlan.findOne({
				userId: targetUserId,
			}).sort({ createdAt: -1 });
			planId = latestPlan ? latestPlan._id.toString() : null;
		}

		// Authorize access before reading rollups. With a plan, getPlan enforces
		// owning-user / assigning-nutritionist / admin. Without one, there is no
		// plan to check ownership against, so staff may only view their own
		// data unless they're an admin — a nutritionist has no standing route
		// to a member's plan-less diary just by knowing their userId.
		if (planId) {
			await getPlan(planId, requester);
		} else if (targetUserId !== requester.id && requester.role !== "admin") {
			throw new NutritionServiceError(
				"FORBIDDEN",
				"You do not have access to this user's adherence",
			);
		}
		const from =
			parsed.data.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const to = parsed.data.to ?? new Date();

		// A day with zero logged food has no materialized rollup at all
		// (recomputeDay only runs on meal-log mutations), so a single-day
		// query — the common "what are today's targets" case — would
		// otherwise come back empty even though the member has real targets
		// to show. Backfill just that one day; multi-day range queries are
		// left as-is (unbounded backfill there would be a needless N-day
		// write on every historical-chart load).
		if (normalizeToUtcDate(from).getTime() === normalizeToUtcDate(to).getTime()) {
			await recomputeDay(targetUserId, planId, from);
		}

		const days = await getAdherenceRange(targetUserId, planId, from, to);
		res.status(200).json({ days });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanAdherence: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = planAdherenceQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		await getPlan(planId, requester);
		const summary = await getPlanAdherenceSummary(
			planId,
			parsed.data.from,
			parsed.data.to,
		);
		res.status(200).json({ summary });
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getMyWeeklyAdherence: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = adherenceRangeQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const isStaff = ["nutritionist", "admin"].includes(requester.role);
		const targetUserId =
			isStaff && parsed.data.userId ? parsed.data.userId : requester.id;

		let planId: string | null;
		if (parsed.data.planId === "none") {
			planId = null;
		} else if (parsed.data.planId) {
			planId = parsed.data.planId;
		} else {
			const latestPlan = await UserNutritionPlan.findOne({
				userId: targetUserId,
			}).sort({ createdAt: -1 });
			planId = latestPlan ? latestPlan._id.toString() : null;
		}

		if (planId) {
			await getPlan(planId, requester);
		} else if (targetUserId !== requester.id && requester.role !== "admin") {
			throw new NutritionServiceError(
				"FORBIDDEN",
				"You do not have access to this user's adherence",
			);
		}
		const result = await getWeeklyAdherence(
			targetUserId,
			planId,
			parsed.data.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
			parsed.data.to ?? new Date(),
		);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const getPlanWeeklyAdherence: RequestHandler = async (
	req,
	res,
	next,
) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = planAdherenceQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const planId = requireIdParam(req.params.id, "Plan not found");
		const plan = await getPlan(planId, requester);
		const rawUserId = plan.userId as unknown;
		const planOwnerId =
			rawUserId && typeof rawUserId === "object" && "_id" in rawUserId
				? String((rawUserId as { _id: unknown })._id)
				: String(rawUserId);
		const result = await getWeeklyAdherence(
			planOwnerId,
			planId,
			parsed.data.from,
			parsed.data.to,
		);
		res.status(200).json(result);
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};

export const rebuildPlanAdherence: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = rebuildAdherenceBodySchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const rebuilt = parsed.data.planId
			? await rebuildAdherence(parsed.data.planId)
			: await rebuildUserAdherence(parsed.data.userId as string);
		res.status(200).json({
			message: "Adherence rebuilt",
			rebuiltDays: rebuilt,
		});
	} catch (error) {
		handleNutritionError(error, res, next);
	}
};
