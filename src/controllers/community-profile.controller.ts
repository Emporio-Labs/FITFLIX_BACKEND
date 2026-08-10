import { unlink } from "node:fs/promises";
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { CommunityRole } from "../models/Enums";
import {
	AvatarUploadError,
	processAndUploadAvatar,
} from "../services/community/avatar.service";
import { decodeCursor } from "../services/community/cursor";
import { can } from "../services/community/policy";
import { getPostsByAuthor } from "../services/community/post.service";
import {
	ProfileNotFoundError,
	buildPublicProfile,
	clearAvatar,
	getMyProfile,
	isBlockedBetween,
	ownerTypeForRole,
	searchPeople,
	setAvatar,
	updateMyProfile,
} from "../services/community/profile.service";
import {
	peopleSearchQuerySchema,
	updateProfileBodySchema,
	userPostsQuerySchema,
} from "../validators/community-profile.validator";

const NOT_FOUND = { error: "Not found", code: "NOT_FOUND" };
const FORBIDDEN = { error: "Forbidden", code: "FORBIDDEN" };
const UNAUTHORIZED = { error: "Unauthorized", code: "UNAUTHORIZED" };

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

const isMember = (role: CommunityRole): boolean =>
	role !== CommunityRole.Outsider;

/** The profile owner type for the CALLER, derived from the JWT identity role
 *  rather than the derived community role. */
const callerOwnerType = (req: { user?: { role?: string } }) =>
	ownerTypeForRole(req.user?.role);

// ────────────────────────────────────────────────────────────────────────────
// Own profile
// ────────────────────────────────────────────────────────────────────────────

export const getMyProfileHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "profile:view")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const profile = await getMyProfile(user.id);
		res.status(200).json({
			profile,
			viewer: { role: user.role, userId: user.id },
		});
	} catch (error) {
		if (error instanceof ProfileNotFoundError) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		next(error);
	}
};

export const updateMyProfileHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		// Suspended and banned accounts are denied here by the shared status gate.
		if (!can(user, "profile:edit")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const parsed = updateProfileBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const profile = await updateMyProfile(
			user.id,
			callerOwnerType(req),
			parsed.data,
		);
		res.status(200).json({ profile });
	} catch (error) {
		if (error instanceof ProfileNotFoundError) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		next(error);
	}
};

/**
 * Replace the caller's avatar.
 *
 * Gated on `profile:edit`, NOT `post:create` like the post-image upload — a
 * member whose plan lapsed can still change their own photo.
 */
export const uploadAvatarHandler: RequestHandler = async (req, res, next) => {
	const file = req.file as Express.Multer.File | undefined;
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "profile:edit")) {
			res.status(403).json(FORBIDDEN);
			return;
		}
		if (!file) {
			res.status(400).json({ error: "No image provided", code: "BAD_REQUEST" });
			return;
		}

		const uploaded = await processAndUploadAvatar(file, user.id);
		const profile = await setAvatar(user.id, callerOwnerType(req), {
			avatarKey: uploaded.avatarKey,
			avatarThumbKey: uploaded.avatarThumbKey,
		});

		res.status(201).json({ profile });
	} catch (error) {
		if (error instanceof AvatarUploadError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		if (error instanceof ProfileNotFoundError) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		next(error);
	} finally {
		// Always clean up the multer temp file.
		if (file) await unlink(file.path).catch(() => {});
	}
};

export const removeAvatarHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "profile:edit")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const profile = await clearAvatar(user.id, callerOwnerType(req));
		res.status(200).json({ profile });
	} catch (error) {
		if (error instanceof ProfileNotFoundError) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		next(error);
	}
};

// ────────────────────────────────────────────────────────────────────────────
// Other people's profiles
// ────────────────────────────────────────────────────────────────────────────

export const getPublicProfileHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "profile:view")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const targetId = getIdParam(req.params.id);
		if (!targetId) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		// A block in EITHER direction reads as "no such profile". Deliberately 404
		// and not 403: a 403 would confirm the account exists.
		if (await isBlockedBetween(user.id, targetId)) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const profile = await buildPublicProfile(targetId, { id: user.id });
		res.status(200).json({
			profile,
			viewer: { role: user.role, userId: user.id },
		});
	} catch (error) {
		if (error instanceof ProfileNotFoundError) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		next(error);
	}
};

export const listUserPostsHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "profile:view")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const targetId = getIdParam(req.params.id);
		if (!targetId) {
			res.status(404).json(NOT_FOUND);
			return;
		}
		if (await isBlockedBetween(user.id, targetId)) {
			res.status(404).json(NOT_FOUND);
			return;
		}

		const parsed = userPostsQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		let cursor = null;
		if (parsed.data.cursor) {
			cursor = decodeCursor(parsed.data.cursor);
			if (!cursor || !mongoose.isValidObjectId(cursor.id)) {
				res.status(400).json({ error: "Invalid cursor", code: "BAD_REQUEST" });
				return;
			}
		}

		// members_only posts come back as the same redacted stubs the feed
		// produces — the redaction lives in the shared post pipeline.
		const result = await getPostsByAuthor(
			targetId,
			isMember(user.role),
			{ cursor, limit: parsed.data.limit },
			user.id,
		);

		res.status(200).json(result);
	} catch (error) {
		next(error);
	}
};

export const searchPeopleHandler: RequestHandler = async (req, res, next) => {
	try {
		const user = req.communityUser;
		if (!user) {
			res.status(401).json(UNAUTHORIZED);
			return;
		}
		if (!can(user, "people:search")) {
			res.status(403).json(FORBIDDEN);
			return;
		}

		const parsed = peopleSearchQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		let cursor = null;
		if (parsed.data.cursor) {
			cursor = decodeCursor(parsed.data.cursor);
			if (!cursor || !mongoose.isValidObjectId(cursor.id)) {
				res.status(400).json({ error: "Invalid cursor", code: "BAD_REQUEST" });
				return;
			}
		}

		const result = await searchPeople(user.id, parsed.data.q, {
			cursor,
			limit: parsed.data.limit,
		});

		res.status(200).json(result);
	} catch (error) {
		next(error);
	}
};
