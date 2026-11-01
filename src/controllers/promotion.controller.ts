import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { Request, RequestHandler } from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import { validateFileSignature } from "../middleware/upload.middleware";
import Promotion from "../models/Promotion";
import { signKeyCached } from "../utils/exercise-images";
import { resolveMemberAudience } from "../utils/membership.guard";
import { deleteFromS3, uploadToS3 } from "../utils/s3.service";
import { getMemberHomeLocationId } from "../utils/location.resolver";
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

const PROMOTION_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const PROMOTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
// Carousel banners are shown at phone width; anything wider is wasted bytes.
const PROMOTION_IMAGE_MAX_WIDTH = 1600;

type PromotionLike = { toJSON(): Record<string, any> };

// Without AWS credentials (local dev) generateSignedUrl falls back to a
// relative `/uploads/<key>` path, which the admin app would resolve against its
// own origin. Make it absolute against this server so the image loads.
const absoluteUrl = (req: Request, url: string | null): string | null =>
	url?.startsWith("/") ? `${req.protocol}://${req.get("host")}${url}` : url;

/**
 * Uploaded images live in the private bucket, so the stored `imageKey` is
 * signed onto `imageUrl` on the way out — the shape every client already
 * renders. Shares exercise-images' cache so repeat reads hand out a
 * byte-identical URL and the app's image cache keeps hitting.
 */
const withSignedImage = async (req: Request, promotion: PromotionLike) => {
	const json = promotion.toJSON();
	if (!json.imageKey) return json;
	const url = absoluteUrl(req, await signKeyCached(json.imageKey));
	return url ? { ...json, imageUrl: url } : json;
};

const withSignedImages = (req: Request, promotions: PromotionLike[]) =>
	Promise.all(promotions.map((p) => withSignedImage(req, p)));

/**
 * Admin uploads a banner before saving the promotion; the returned `imageKey`
 * then goes into the create/update body. Re-encoded to JPEG and capped in
 * width so a 12 MP phone photo doesn't become the carousel's download.
 */
export const uploadPromotionImage: RequestHandler = async (req, res, next) => {
	const file = req.file as Express.Multer.File | undefined;
	try {
		if (!file) {
			res.status(400).json({ error: "No image provided", code: "BAD_REQUEST" });
			return;
		}

		const mime = file.mimetype.toLowerCase();
		if (!PROMOTION_IMAGE_MIME_TYPES.includes(mime)) {
			res.status(415).json({
				error: "Only JPG, PNG or WebP images are allowed",
				code: "UNSUPPORTED_MEDIA_TYPE",
			});
			return;
		}

		if (file.size > PROMOTION_IMAGE_MAX_BYTES) {
			res.status(413).json({
				error: "Image must be 5 MB or smaller",
				code: "PAYLOAD_TOO_LARGE",
			});
			return;
		}

		// Content sniffing: a renamed file declared as image/png fails here.
		const expected = mime === "image/jpg" ? "image/jpeg" : mime;
		if (!(await validateFileSignature(file.path, expected))) {
			res.status(400).json({
				error: "File content does not match an allowed image type",
				code: "INVALID_IMAGE",
			});
			return;
		}

		let image: Awaited<ReturnType<typeof Jimp.read>>;
		try {
			image = await Jimp.read(file.path);
		} catch {
			res
				.status(400)
				.json({ error: "Image could not be decoded", code: "INVALID_IMAGE" });
			return;
		}

		// Never upscale — a small source stays its own size.
		if (image.width > PROMOTION_IMAGE_MAX_WIDTH) {
			image.resize({ w: PROMOTION_IMAGE_MAX_WIDTH });
		}
		const buffer = await image.getBuffer("image/jpeg", { quality: 85 });

		// Fresh UUID per upload: the app caches images by object path, so an
		// overwritten key would keep serving the old banner.
		const imageKey = `promotions/${randomUUID()}/banner.jpg`;
		try {
			await uploadToS3(imageKey, buffer, "image/jpeg");
		} catch (error) {
			// Almost always credentials/IAM (AccessDenied) — say so instead of a
			// bare 500, so the admin's toast points at storage, not their image.
			console.error("[promotion-image] storage upload failed:", error);
			res.status(502).json({
				error:
					"Image storage rejected the upload. Check the server's S3 credentials and permissions.",
				code: "STORAGE_ERROR",
			});
			return;
		}

		res.status(201).json({
			message: "Image uploaded",
			imageKey,
			imageUrl: absoluteUrl(req, await signKeyCached(imageKey)),
		});
	} catch (error) {
		next(error);
	} finally {
		if (file) await unlink(file.path).catch(() => {});
	}
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

		// A member sees their home club's offers plus company-wide ones. The app
		// sends no branch, so it comes from their record; a member without a
		// home club keeps seeing everything, as with a single branch.
		const memberHome =
			req.user?.role === "user"
				? await getMemberHomeLocationId(req.user.id)
				: null;

		// Members only ever see live, in-window promotions; staff can ask for
		// the full list to manage it.
		const filter = buildPromotionFilter({
			role: req.user?.role,
			locationId: memberHome ?? location.locationId,
			includeInactive,
			audience,
		});

		const promotions = await Promotion.find(filter).sort(PROMOTION_SORT);

		res.status(200).json({
			promotions: await withSignedImages(req, promotions),
			count: promotions.length,
		});
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

		res.status(200).json({
			promotions: await withSignedImages(req, promotions),
			count: promotions.length,
		});
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

		res.status(200).json({ promotion: await withSignedImage(req, promotion) });
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
		// One image source only: an uploaded key wins over a typed URL.
		const data = parsed.data.imageKey
			? { ...parsed.data, imageUrl: null }
			: { ...parsed.data, imageKey: null };
		const promotion = await Promotion.create(data);
		res.status(201).json({
			message: "Promotion created",
			promotion: await withSignedImage(req, promotion),
		});
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
		const existing = await Promotion.findById(id).select(
			"activeFrom activeTo imageUrl imageKey",
		);
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

		// Setting one image source clears the other, and the merged result must
		// still have one.
		const update: Record<string, unknown> = { ...parsed.data };
		if (parsed.data.imageKey) update.imageUrl = null;
		else if (parsed.data.imageUrl) update.imageKey = null;
		const nextImageUrl =
			"imageUrl" in update ? update.imageUrl : existing.imageUrl;
		const nextImageKey =
			"imageKey" in update ? update.imageKey : existing.imageKey;
		if (!nextImageUrl && !nextImageKey) {
			invalidPayload(res, [
				{
					path: ["imageUrl"],
					message: "An image is required — upload one or give an image URL",
				},
			]);
			return;
		}

		const promotion = await Promotion.findByIdAndUpdate(
			id,
			{ $set: update },
			{ new: true, runValidators: true },
		);

		if (!promotion) {
			notFound(res);
			return;
		}

		// The replaced upload is no longer referenced by anything.
		if (existing.imageKey && existing.imageKey !== promotion.imageKey) {
			await deleteFromS3(existing.imageKey);
		}

		res.status(200).json({
			message: "Promotion updated",
			promotion: await withSignedImage(req, promotion),
		});
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

		if (promotion.imageKey) await deleteFromS3(promotion.imageKey);

		res.status(200).json({ message: "Promotion deleted", promotion });
	} catch (error) {
		next(error);
	}
};
