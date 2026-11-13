import type { RequestHandler } from "express";
import mongoose from "mongoose";
import ProgressPhoto, { PhotoPose } from "../models/ProgressPhoto";
import User from "../models/User";
import { assertNutritionistOwnsMember } from "../services/nutritionistRoster.service";
import {
	ProgressPhotoServiceError,
	deletePhotoStorage,
	enrichPhotoWithUrls,
	normalizeToDayStart,
	processAndUploadProgressPhoto,
} from "../services/progress-photo.service";
import { assertTrainerOwnsMember } from "../services/trainerRoster.service";
import {
	comparePhotosQuerySchema,
	progressPhotosQuerySchema,
	uploadProgressPhotoSchema,
} from "../validators/progress-photo.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) return null;
	return idParam;
};

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field =
			issue.path && issue.path.length > 0
				? issue.path.map(String).join(".")
				: "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}
	return details;
};

/**
 * Helper to group an array of enriched photo documents by calendar date string (YYYY-MM-DD).
 */
const groupPhotosByDate = (photos: any[]) => {
	const groupsMap = new Map<string, {
		date: string;
		recordedDate: Date;
		weightKg?: number;
		notes?: string;
		poses: {
			front?: any;
			side?: any;
			back?: any;
		};
	}>();

	for (const p of photos) {
		const d = new Date(p.recordedDate);
		const key = d.toISOString().slice(0, 10);
		if (!groupsMap.has(key)) {
			groupsMap.set(key, {
				date: key,
				recordedDate: d,
				weightKg: p.weightKg,
				notes: p.notes,
				poses: {},
			});
		}
		const group = groupsMap.get(key)!;
		if (p.weightKg !== undefined && group.weightKg === undefined) {
			group.weightKg = p.weightKg;
		}
		if (p.notes && !group.notes) {
			group.notes = p.notes;
		}
		if (p.pose === PhotoPose.Front) group.poses.front = p;
		else if (p.pose === PhotoPose.Side) group.poses.side = p;
		else if (p.pose === PhotoPose.Back) group.poses.back = p;
	}

	return Array.from(groupsMap.values());
};

/**
 * Asserts staff member has authorized access to a target member's progress photos.
 * Allowed:
 *  - "admin" | "frontdesk"
 *  - "trainer": must own member via assertTrainerOwnsMember
 *  - "nutritionist": must own member via assertNutritionistOwnsMember
 */
const assertStaffCanAccessMemberPhotos = async (requester: { id: string; role: string }, memberId: string): Promise<void> => {
	if (requester.role === "admin" || requester.role === "frontdesk") {
		return;
	}

	if (requester.role === "trainer") {
		await assertTrainerOwnsMember(requester.id, memberId);
		return;
	}

	if (requester.role === "nutritionist") {
		await assertNutritionistOwnsMember(requester.id, memberId);
		return;
	}

	const error: any = new Error("You do not have permission to view this member's photos");
	error.status = 403;
	error.code = "FORBIDDEN";
	throw error;
};

/**
 * POST /progress/photos
 * Member uploads a progress photo (multipart/form-data: file + pose + optional recordedDate, weightKg, notes, isPrivateToSelf).
 */
export const uploadProgressPhoto: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Only members can upload progress photos", code: "FORBIDDEN" });
		return;
	}

	if (!req.file) {
		res.status(400).json({ error: "Photo file is required", code: "VALIDATION_ERROR", details: { file: "Required" } });
		return;
	}

	const parsed = uploadProgressPhotoSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const recordedDate = normalizeToDayStart(parsed.data.recordedDate);
		const capturedAt = parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : new Date();

		const processed = await processAndUploadProgressPhoto(
			req.user.id,
			parsed.data.pose,
			recordedDate,
			req.file,
		);

		// If a photo for this user, date, and pose already exists, replace it and clean up old S3 assets
		const existing = await ProgressPhoto.findOne({
			userId: req.user.id,
			recordedDate,
			pose: parsed.data.pose,
		});

		let savedPhoto: any;

		if (existing) {
			const oldS3Key = existing.s3Key;
			const oldThumbKey = existing.thumbnailKey;

			existing.s3Key = processed.s3Key;
			existing.thumbnailKey = processed.thumbnailKey;
			existing.capturedAt = capturedAt;
			if (parsed.data.weightKg !== undefined) existing.weightKg = parsed.data.weightKg;
			if (parsed.data.notes !== undefined) existing.notes = parsed.data.notes;
			existing.isPrivateToSelf = parsed.data.isPrivateToSelf;

			savedPhoto = await existing.save();

			// Clean up previous storage asynchronously
			deletePhotoStorage(oldS3Key, oldThumbKey).catch((err) =>
				console.error("[PROGRESS_PHOTO] Old S3 cleanup error:", err?.message || err),
			);
		} else {
			savedPhoto = await ProgressPhoto.create({
				userId: req.user.id,
				recordedDate,
				capturedAt,
				pose: parsed.data.pose,
				s3Key: processed.s3Key,
				thumbnailKey: processed.thumbnailKey,
				weightKg: parsed.data.weightKg,
				notes: parsed.data.notes,
				isPrivateToSelf: parsed.data.isPrivateToSelf,
			});
		}

		const enriched = {
			...savedPhoto.toObject(),
			url: processed.url,
			thumbnailUrl: processed.thumbnailUrl,
		};

		res.status(201).json({
			message: "Progress photo uploaded successfully",
			photo: enriched,
		});
	} catch (error: any) {
		if (error instanceof ProgressPhotoServiceError) {
			res.status(error.status).json({ error: error.message, code: error.code });
			return;
		}
		next(error);
	}
};

/**
 * GET /progress/photos/me
 * Retrieves member's own progress photos timeline.
 */
export const getMyProgressPhotos: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Unauthorized", code: "FORBIDDEN" });
		return;
	}

	const parsed = progressPhotosQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const query: any = { userId: req.user.id };
		if (parsed.data.pose) query.pose = parsed.data.pose;
		if (parsed.data.from || parsed.data.to) {
			query.recordedDate = {};
			if (parsed.data.from) query.recordedDate.$gte = normalizeToDayStart(parsed.data.from);
			if (parsed.data.to) query.recordedDate.$lte = normalizeToDayStart(parsed.data.to);
		}

		const rawPhotos = await ProgressPhoto.find(query)
			.sort({ recordedDate: -1, pose: 1 })
			.limit(parsed.data.limit)
			.lean();

		const enrichedPhotos = await Promise.all(rawPhotos.map(enrichPhotoWithUrls));
		const checkIns = groupPhotosByDate(enrichedPhotos);

		res.status(200).json({
			total: enrichedPhotos.length,
			checkIns,
			photos: enrichedPhotos,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * GET /progress/photos/me/compare?dateA=YYYY-MM-DD&dateB=YYYY-MM-DD
 * Compares photos from two distinct dates.
 */
export const getMyComparison: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Unauthorized", code: "FORBIDDEN" });
		return;
	}

	const parsed = comparePhotosQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		const dateA = normalizeToDayStart(parsed.data.dateA);
		const dateB = normalizeToDayStart(parsed.data.dateB);

		const [photosA, photosB] = await Promise.all([
			ProgressPhoto.find({ userId: req.user.id, recordedDate: dateA }).lean(),
			ProgressPhoto.find({ userId: req.user.id, recordedDate: dateB }).lean(),
		]);

		const [enrichedA, enrichedB] = await Promise.all([
			Promise.all(photosA.map(enrichPhotoWithUrls)),
			Promise.all(photosB.map(enrichPhotoWithUrls)),
		]);

		const groupA = groupPhotosByDate(enrichedA)[0] ?? {
			date: dateA.toISOString().slice(0, 10),
			recordedDate: dateA,
			poses: {},
		};

		const groupB = groupPhotosByDate(enrichedB)[0] ?? {
			date: dateB.toISOString().slice(0, 10),
			recordedDate: dateB,
			poses: {},
		};

		res.status(200).json({
			before: groupA,
			after: groupB,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * DELETE /progress/photos/:id
 * Member deletes one of their own progress photos.
 */
export const deleteMyProgressPhoto: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Unauthorized", code: "FORBIDDEN" });
		return;
	}

	const photoId = getIdParam(req.params.id);
	if (!photoId) {
		res.status(400).json({ error: "Invalid photo id", code: "VALIDATION_ERROR" });
		return;
	}

	try {
		const photo = await ProgressPhoto.findOne({ _id: photoId, userId: req.user.id });
		if (!photo) {
			res.status(404).json({ error: "Progress photo not found", code: "NOT_FOUND" });
			return;
		}

		await deletePhotoStorage(photo.s3Key, photo.thumbnailKey);
		await photo.deleteOne();

		res.status(200).json({ message: "Progress photo deleted successfully" });
	} catch (error) {
		next(error);
	}
};

/**
 * GET /progress/photos/user/:userId
 * Staff (admin, frontdesk, assigned trainer, assigned nutritionist) views member's progress photos.
 * Skips photos where isPrivateToSelf === true.
 */
export const getMemberProgressPhotosForStaff: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const memberId = getIdParam(req.params.userId);
	if (!memberId) {
		res.status(400).json({ error: "Invalid member id", code: "VALIDATION_ERROR" });
		return;
	}

	const parsed = progressPhotosQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		await assertStaffCanAccessMemberPhotos(req.user, memberId);

		const query: any = {
			userId: memberId,
			isPrivateToSelf: { $ne: true },
		};

		if (parsed.data.pose) query.pose = parsed.data.pose;
		if (parsed.data.from || parsed.data.to) {
			query.recordedDate = {};
			if (parsed.data.from) query.recordedDate.$gte = normalizeToDayStart(parsed.data.from);
			if (parsed.data.to) query.recordedDate.$lte = normalizeToDayStart(parsed.data.to);
		}

		const rawPhotos = await ProgressPhoto.find(query)
			.sort({ recordedDate: -1, pose: 1 })
			.limit(parsed.data.limit)
			.lean();

		const enrichedPhotos = await Promise.all(rawPhotos.map(enrichPhotoWithUrls));
		const checkIns = groupPhotosByDate(enrichedPhotos);

		res.status(200).json({
			memberId,
			total: enrichedPhotos.length,
			checkIns,
			photos: enrichedPhotos,
		});
	} catch (error: any) {
		if (error?.status === 403 || error?.name === "NutritionistRosterError" || error?.name === "TrainerRosterError") {
			res.status(403).json({ error: error.message || "This member is not assigned to you", code: "FORBIDDEN" });
			return;
		}
		next(error);
	}
};

/**
 * GET /progress/photos/user/:userId/compare?dateA=YYYY-MM-DD&dateB=YYYY-MM-DD
 * Staff compares member photos between two dates during reviews/consultations.
 */
export const getMemberComparisonForStaff: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const memberId = getIdParam(req.params.userId);
	if (!memberId) {
		res.status(400).json({ error: "Invalid member id", code: "VALIDATION_ERROR" });
		return;
	}

	const parsed = comparePhotosQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		await assertStaffCanAccessMemberPhotos(req.user, memberId);

		const dateA = normalizeToDayStart(parsed.data.dateA);
		const dateB = normalizeToDayStart(parsed.data.dateB);

		const [photosA, photosB] = await Promise.all([
			ProgressPhoto.find({ userId: memberId, recordedDate: dateA, isPrivateToSelf: { $ne: true } }).lean(),
			ProgressPhoto.find({ userId: memberId, recordedDate: dateB, isPrivateToSelf: { $ne: true } }).lean(),
		]);

		const [enrichedA, enrichedB] = await Promise.all([
			Promise.all(photosA.map(enrichPhotoWithUrls)),
			Promise.all(photosB.map(enrichPhotoWithUrls)),
		]);

		const groupA = groupPhotosByDate(enrichedA)[0] ?? {
			date: dateA.toISOString().slice(0, 10),
			recordedDate: dateA,
			poses: {},
		};

		const groupB = groupPhotosByDate(enrichedB)[0] ?? {
			date: dateB.toISOString().slice(0, 10),
			recordedDate: dateB,
			poses: {},
		};

		res.status(200).json({
			memberId,
			before: groupA,
			after: groupB,
		});
	} catch (error: any) {
		if (error?.status === 403 || error?.name === "NutritionistRosterError" || error?.name === "TrainerRosterError") {
			res.status(403).json({ error: error.message || "This member is not assigned to you", code: "FORBIDDEN" });
			return;
		}
		next(error);
	}
};
