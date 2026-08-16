import type { RequestHandler } from "express";
import mongoose from "mongoose";
import ContentOverride, {
	CONTENT_PLATFORMS,
} from "../models/ContentOverride";
import {
	buildContentFilter,
	type ContentPlatform,
	isContentPlatform,
	resolveContentMap,
} from "../utils/content-resolution";
import {
	createContentOverrideSchema,
	updateContentOverrideSchema,
} from "../validators/content.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const getPlatformParam = (
	value: unknown,
): { ok: true; platform: ContentPlatform | null } | { ok: false } => {
	if (value === undefined || value === "") return { ok: true, platform: null };
	if (!isContentPlatform(value)) return { ok: false };
	return { ok: true, platform: value };
};

const invalidId = (res: Parameters<RequestHandler>[1]) => {
	res
		.status(400)
		.json({ message: "Invalid content id", code: "INVALID_CONTENT_ID" });
};

const notFound = (res: Parameters<RequestHandler>[1]) => {
	res
		.status(404)
		.json({ message: "Content override not found", code: "CONTENT_NOT_FOUND" });
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

const duplicateKey = (res: Parameters<RequestHandler>[1]) => {
	res.status(409).json({
		message: "An override already exists for this key and platform",
		code: "CONTENT_KEY_EXISTS",
	});
};

const isDuplicateKeyError = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: number }).code === 11000;

/**
 * The app's read path. Unauthenticated, because the pre-login landing page
 * needs it too.
 *
 * Returns a flat `{ key: value }` map rather than rows: the client resolves a
 * string by key and has no use for the surrounding metadata, and a map keeps
 * the payload small enough to fetch on every cold start.
 *
 * An empty map is a correct, expected answer. The app treats it — and a 404,
 * and a timeout — the same way: keep the copy baked into the build.
 */
export const getPublicContent: RequestHandler = async (req, res, next) => {
	try {
		const platform = getPlatformParam(req.query.platform);
		if (!platform.ok) {
			res.status(400).json({
				message: `platform must be one of: ${CONTENT_PLATFORMS.join(", ")}`,
				code: "INVALID_PLATFORM",
			});
			return;
		}

		const rows = await ContentOverride.find(
			buildContentFilter({ platform: platform.platform }),
		).select("key value platform");

		const content = resolveContentMap(rows);

		// Short window: marketing expects an edit to show up promptly, and the
		// app already holds its own cache for the offline case.
		res.set("Cache-Control", "public, max-age=60");
		res.status(200).json({ content, count: Object.keys(content).length });
	} catch (error) {
		next(error);
	}
};

export const getAllContentOverrides: RequestHandler = async (req, res, next) => {
	try {
		const filter: Record<string, unknown> = {};
		if (String(req.query.includeInactive ?? "") !== "true") {
			filter.isActive = true;
		}
		if (typeof req.query.key === "string" && req.query.key) {
			filter.key = req.query.key.trim();
		}

		const overrides = await ContentOverride.find(filter).sort({
			key: 1,
			platform: 1,
		});
		res.status(200).json({ overrides, count: overrides.length });
	} catch (error) {
		next(error);
	}
};

export const createContentOverride: RequestHandler = async (req, res, next) => {
	try {
		const parsed = createContentOverrideSchema.safeParse(req.body);
		if (!parsed.success) {
			invalidPayload(res, parsed.error.flatten());
			return;
		}

		const override = await ContentOverride.create({
			...parsed.data,
			platform: parsed.data.platform ?? null,
		});
		res.status(201).json({ override });
	} catch (error) {
		if (isDuplicateKeyError(error)) {
			duplicateKey(res);
			return;
		}
		next(error);
	}
};

export const updateContentOverrideById: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			invalidId(res);
			return;
		}

		const parsed = updateContentOverrideSchema.safeParse(req.body);
		if (!parsed.success) {
			invalidPayload(res, parsed.error.flatten());
			return;
		}

		const override = await ContentOverride.findByIdAndUpdate(id, parsed.data, {
			new: true,
			runValidators: true,
		});
		if (!override) {
			notFound(res);
			return;
		}
		res.status(200).json({ override });
	} catch (error) {
		if (isDuplicateKeyError(error)) {
			duplicateKey(res);
			return;
		}
		next(error);
	}
};

/**
 * Deleting restores the app's baked-in default for that key — which is the
 * intended way to undo an override, as opposed to setting `isActive: false`
 * when you want to keep the text around for later.
 */
export const deleteContentOverrideById: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const id = getIdParam(req.params.id);
		if (!id) {
			invalidId(res);
			return;
		}

		const override = await ContentOverride.findByIdAndDelete(id);
		if (!override) {
			notFound(res);
			return;
		}
		res.status(200).json({ message: "Content override deleted" });
	} catch (error) {
		next(error);
	}
};
