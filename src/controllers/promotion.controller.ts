import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Promotion from "../models/Promotion";
import { resolveMemberAudience } from "../utils/membership.guard";
import {
	buildPromotionFilter,
	canSeeHiddenPromotions,
	PROMOTION_SORT,
} from "../utils/promotion-visibility";
import {
	createPromotionSchema,
	updatePromotionSchema,
} from "../validators/promotion.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const getLocationParam = (
	value: unknown,
): { ok: true; locationId: string | null } | { ok: false } => {
	if (value === undefined || value === "") return { ok: true, locationId: null };
	if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
		return { ok: false };
	}
	return { ok: true, locationId: value };
};

const invalidId = (res: Parameters<RequestHandler>[1]) => {
	res
		.status(400)
		.json({ message: "Invalid promotion id", code: "INVALID_PROMOTION_ID" });
};

const notFound = (res: Parameters<RequestHandler>[1]) => {
	res
		.status(404)
		.json({ message: "Promotion not found", code: "PROMOTION_NOT_FOUND" });
};

const invalidPayload = (
	res: Parameters<RequestHandler>[1],
	details: unknown,
) => {
	res.status(400).json({
		message: "Invalid payload",
		code: "INVALID_PAYLOAD",
		details,
	});
};

export const getAllPromotions: RequestHandler = async (req, res, next) => {
	try {
		const location = getLocationParam(req.query.locationId);
		if (!location.ok) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		// Staff manage the whole catalogue, so they are not audience-filtered;
		// everyone else sees only what is pitched at them. Resolving the
		// audience costs a membership lookup, so it is skipped for the staff
		// path that is about to ignore it anyway.
		const includeInactive =
			String(req.query.includeInactive ?? "") === "true";
		const isStaffListing =
			includeInactive && canSeeHiddenPromotions(req.user?.role);
		const audience =
			isStaffListing || !req.user?.id
				? null
				: await resolveMemberAudience(req.user.id);

		// Members only ever see live, in-window promotions; staff can ask for
		// the full list to manage it.
		const filter = buildPromotionFilter({
			role: req.user?.role,
			locationId: location.locationId,
			includeInactive,
			audience,
		});

		const promotions = await Promotion.find(filter).sort(PROMOTION_SORT);

		res.status(200).json({ promotions, count: promotions.length });
	} catch (error) {
		next(error);
	}
};

/**
 * Pre-login surface. Registered before `authenticateToken`, following
 * therapy.routes.ts, so the visitor home screen can carry promotions.
 * There is no role here, so the live-and-in-window filter always applies.
 */
export const getPublicPromotions: RequestHandler = async (req, res, next) => {
	try {
		const location = getLocationParam(req.query.locationId);
		if (!location.ok) {
			res
				.status(400)
				.json({ message: "Invalid location id", code: "INVALID_LOCATION_ID" });
			return;
		}

		// Nobody is signed in here, so the viewer is a prospect by definition.
		// Member-only and win-back offers must not leak onto the landing page.
		const promotions = await Promotion.find(
			buildPromotionFilter({
				locationId: location.locationId,
				audience: "non_member",
			}),
		).sort(PROMOTION_SORT);

		res.status(200).json({ promotions, count: promotions.length });
	} catch (error) {
		next(error);
	}
};

export const getPromotionById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			invalidId(res);
			return;
		}

		const promotion = await Promotion.findById(id);
		if (!promotion) {
			notFound(res);
			return;
		}

		// A member fetching a promotion directly must not see one that is off or
		// out of window just because they know its id.
		if (!canSeeHiddenPromotions(req.user?.role)) {
			const now = new Date();
			const live =
				promotion.isActive === true &&
				promotion.activeFrom <= now &&
				promotion.activeTo >= now;
			if (!live) {
				notFound(res);
				return;
			}
		}

		res.status(200).json({ promotion });
	} catch (error) {
		next(error);
	}
};

export const createPromotion: RequestHandler = async (req, res, next) => {
	const parsed = createPromotionSchema.safeParse(req.body);
	if (!parsed.success) {
		invalidPayload(res, parsed.error.issues);
		return;
	}

	try {
		const promotion = await Promotion.create(parsed.data);
		res.status(201).json({ message: "Promotion created", promotion });
	} catch (error) {
		next(error);
	}
};

export const updatePromotionById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);
	if (!id) {
		invalidId(res);
		return;
	}

	const parsed = updatePromotionSchema.safeParse(req.body);
	if (!parsed.success) {
		invalidPayload(res, parsed.error.issues);
		return;
	}

	try {
		const existing = await Promotion.findById(id).select("activeFrom activeTo");
		if (!existing) {
			notFound(res);
			return;
		}

		// Moving one end of the window in isolation can still invert it, and the
		// validator only sees the fields that were sent — so the ordering rule is
		// re-checked against the merged result.
		const activeFrom = parsed.data.activeFrom ?? existing.activeFrom;
		const activeTo = parsed.data.activeTo ?? existing.activeTo;
		if (activeTo <= activeFrom) {
			invalidPayload(res, [
				{
					path: ["activeTo"],
					message: "activeTo must be after activeFrom",
				},
			]);
			return;
		}

		const promotion = await Promotion.findByIdAndUpdate(
			id,
			{ $set: parsed.data },
			{ new: true, runValidators: true },
		);

		if (!promotion) {
			notFound(res);
			return;
		}

		res.status(200).json({ message: "Promotion updated", promotion });
	} catch (error) {
		next(error);
	}
};

/**
 * Hard delete, unlike Location's deactivate-in-place.
 *
 * A promotion is pointed outward and nothing references it, so removing the
 * document orphans no history. Taking one off the carousel without deleting it
 * is what `isActive: false` is for.
 */
export const deletePromotionById: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			invalidId(res);
			return;
		}

		const promotion = await Promotion.findByIdAndDelete(id);
		if (!promotion) {
			notFound(res);
			return;
		}

		res.status(200).json({ message: "Promotion deleted", promotion });
	} catch (error) {
		next(error);
	}
};
