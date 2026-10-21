import type { RequestHandler } from "express";
import mongoose from "mongoose";
import MembershipPlan from "../models/MembershipPlan";
import {
	buildLocationFilter,
	LocationError,
	mapLocationError,
	resolveLocationId,
} from "../utils/location.resolver";
import {
	createMembershipPlanSchema,
	updateMembershipPlanSchema,
} from "../validators/membershipPlan.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

// A plan's branch: null stays null (every branch); a value must be an active
// branch. Throws LocationError.
const resolvePlanLocation = async (
	locationId: string | null | undefined,
): Promise<{ locationId?: mongoose.Types.ObjectId | null }> => {
	if (locationId === undefined) return {};
	return { locationId: locationId ? await resolveLocationId(locationId) : null };
};

export const createMembershipPlan: RequestHandler = async (req, res, _next) => {
	const requestId = `${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;

	const parsed = createMembershipPlanSchema.safeParse(req.body);
	if (!parsed.success) {
		console.warn("createMembershipPlan validation failed", {
			requestId,
			errors: parsed.error.issues,
		});
		res.status(400).json({
			message: "Invalid payload",
			code: "INVALID_PAYLOAD",
			requestId,
			details: parsed.error.issues,
		});
		return;
	}

	try {
		console.info("createMembershipPlan request", {
			requestId,
			body: { name: parsed.data.name, gymId: parsed.data.gymId },
		});
		const { locationId, ...fields } = parsed.data;
		const plan = await MembershipPlan.create({
			...fields,
			...(await resolvePlanLocation(locationId)),
		});
		res
			.status(201)
			.json({ message: "Membership plan created", plan, requestId });
	} catch (error: unknown) {
		if (error instanceof LocationError) {
			const mapped = mapLocationError(error);
			res
				.status(mapped.status)
				.json({ message: mapped.message, code: mapped.code, requestId });
			return;
		}
		const err = error as any;
		if (err.name === "MongoServerError" && err.code === 11000) {
			console.warn("createMembershipPlan duplicate key", {
				requestId,
				error: err.message,
			});
			res.status(409).json({
				message: "Membership plan already exists",
				code: "DUPLICATE_RESOURCE",
				requestId,
				details: err.keyValue ?? null,
			});
			return;
		}

		console.error("createMembershipPlan error", {
			requestId,
			error: String(error),
		});
		res.status(500).json({
			message: "Failed to create membership plan",
			code: "INTERNAL_ERROR",
			requestId,
		});
	}
};

/**
 * `?locationId=X` → the plans sold at X plus the all-branch plans
 * (locationId null). Plans past `availableUntil` are hidden unless
 * `?includeExpired=true`.
 */
export const getAllMembershipPlans: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const { locationId, includeExpired } = req.query;
		const clauses: Record<string, unknown>[] = [];

		if (typeof locationId === "string" && locationId) {
			const branch = buildLocationFilter(locationId);
			// `locationId: null` also matches plans saved before the field existed.
			clauses.push({ $or: [branch, { locationId: null }] });
		}
		if (includeExpired !== "true") {
			clauses.push({
				$or: [{ availableUntil: null }, { availableUntil: { $gt: new Date() } }],
			});
		}

		const plans = await MembershipPlan.find(
			clauses.length > 0 ? { $and: clauses } : {},
		);
		res.status(200).json({ plans });
	} catch (error) {
		if (error instanceof LocationError) {
			const mapped = mapLocationError(error);
			res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
			return;
		}
		next(error);
	}
};

export const getMembershipPlanById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid id" });
		return;
	}

	try {
		const plan = await MembershipPlan.findById(id);
		if (!plan) {
			res.status(404).json({ message: "Membership plan not found" });
			return;
		}

		res.status(200).json({ plan });
	} catch (error) {
		next(error);
	}
};

export const updateMembershipPlanById: RequestHandler = async (
	req,
	res,
	_next,
) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid id" });
		return;
	}

	const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

	const parsed = updateMembershipPlanSchema.safeParse(req.body);
	if (!parsed.success) {
		console.warn("updateMembershipPlan validation failed", {
			requestId,
			errors: parsed.error.issues,
		});
		res.status(400).json({
			message: "Invalid payload",
			code: "INVALID_PAYLOAD",
			requestId,
			details: parsed.error.issues,
		});
		return;
	}

	try {
		console.info("updateMembershipPlan request", {
			requestId,
			id,
			body: parsed.data,
		});
		const { locationId, ...fields } = parsed.data;
		const updated = await MembershipPlan.findByIdAndUpdate(
			id,
			{ ...fields, ...(await resolvePlanLocation(locationId)) },
			{ returnDocument: "after", runValidators: true },
		);

		if (!updated) {
			res.status(404).json({ message: "Membership plan not found", requestId });
			return;
		}

		res
			.status(200)
			.json({ message: "Membership plan updated", plan: updated, requestId });
	} catch (error: unknown) {
		if (error instanceof LocationError) {
			const mapped = mapLocationError(error);
			res
				.status(mapped.status)
				.json({ message: mapped.message, code: mapped.code, requestId });
			return;
		}
		const err = error as any;
		if (err.name === "MongoServerError" && err.code === 11000) {
			console.warn("updateMembershipPlan duplicate key", {
				requestId,
				error: err.message,
			});
			res.status(409).json({
				message: "Duplicate resource",
				code: "DUPLICATE_RESOURCE",
				requestId,
				details: err.keyValue ?? null,
			});
			return;
		}

		console.error("updateMembershipPlan error", {
			requestId,
			error: String(error),
			id,
		});
		res.status(500).json({
			message: "Failed to update membership plan",
			code: "INTERNAL_ERROR",
			requestId,
		});
	}
};

export const deleteMembershipPlanById: RequestHandler = async (
	req,
	res,
	next,
) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ message: "Invalid id" });
		return;
	}

	try {
		const deleted = await MembershipPlan.findByIdAndDelete(id);
		if (!deleted) {
			res.status(404).json({ message: "Membership plan not found" });
			return;
		}

		res.status(200).json({ message: "Membership plan deleted" });
	} catch (error) {
		next(error);
	}
};
