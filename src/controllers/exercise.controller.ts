import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Exercise from "../models/Exercise";
import {
	createExerciseBodySchema,
	listExercisesQuerySchema,
	updateExerciseBodySchema,
} from "../validators/exercise.validator";
import { generateSignedUrl } from "../utils/s3.service";

// Exercise demo images live in a PRIVATE S3 prefix, so the documents store
// object keys (`imageKeys`) rather than fetchable URLs. Every read endpoint
// signs those keys here and projects the result onto `imageUrl` / `imageUrls`,
// which is the shape every existing client already consumes.
//
// Rows with no `imageKeys` (custom exercises, or anything created through the
// API with a plain `imageUrl`) are passed through untouched — signing must
// never clobber a URL somebody set by hand.
const IMAGE_URL_TTL_SECONDS = Number(
	process.env.EXERCISE_IMAGE_URL_TTL_SECONDS ?? 3600,
);

// A fresh presign produces a different query string every call, so re-signing
// on each request would change every <img src> and force the browser to
// re-download all ~48 frames on a page of results. Cache the signed URL per key
// and reuse it until it is close to expiry, so repeat requests return a byte
// -identical URL and hit the browser cache instead.
const SIGNED_URL_REUSE_MS = Math.max(
	60_000,
	(IMAGE_URL_TTL_SECONDS - 300) * 1000,
);
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

const signKeyCached = async (key: string): Promise<string | null> => {
	const now = Date.now();
	const hit = signedUrlCache.get(key);
	if (hit && hit.expiresAt > now) return hit.url;

	try {
		const url = await generateSignedUrl(key, IMAGE_URL_TTL_SECONDS, "image/jpeg");
		signedUrlCache.set(key, { url, expiresAt: now + SIGNED_URL_REUSE_MS });
		return url;
	} catch {
		return null;
	}
};

const withSignedImages = async <T extends Record<string, any>>(
	doc: T,
): Promise<T> => {
	const keys: string[] = Array.isArray(doc.imageKeys) ? doc.imageKeys : [];
	if (keys.length === 0) return doc;

	const signed = await Promise.all(keys.map(signKeyCached));
	const usable = signed.filter((u): u is string => Boolean(u));
	if (usable.length === 0) return doc;

	return { ...doc, imageUrl: usable[0], imageUrls: usable };
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}
	return idParam;
};

export const listExercises: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user || { id: new mongoose.Types.ObjectId().toHexString() };
		if (!requester) {
			console.log("[listExercises] 401 Unauthorized");
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const parsed = listExercisesQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			console.error("[listExercises] 400 Validation failed:", req.query, parsed.error.issues);
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const {
			muscleGroup,
			difficulty,
			section,
			equipment,
			search,
			isSystem,
			page,
			limit,
		} = parsed.data;

		// Soft-deleted exercises stay readable by the name-resolution joins in
		// the plan/assignment/session controllers, but must never appear in a
		// picker — otherwise a trainer can assign an exercise that is on its way
		// out and re-orphan the reference later.
		const filter: Record<string, unknown> = { isDeleted: { $ne: true } };

		if (typeof isSystem === "boolean") {
			if (isSystem) {
				filter.isSystem = true;
			} else {
				filter.isSystem = false;
				filter.createdBy = new mongoose.Types.ObjectId(requester.id);
			}
		} else {
			filter.$or = [
				{ isSystem: true },
				{ createdBy: new mongoose.Types.ObjectId(requester.id) },
			];
		}

		if (muscleGroup) filter.muscleGroups = muscleGroup;
		if (difficulty) filter.difficulty = difficulty;
		// Array-membership match: returns exercises usable in this section.
		if (section) filter.sectionTypes = section;
		if (equipment) filter.equipment = { $regex: equipment, $options: "i" };
		if (search) filter.name = { $regex: search, $options: "i" };

		const [rows, total] = await Promise.all([
			Exercise.find(filter)
				.sort({ isSystem: -1, name: 1 })
				.skip((page - 1) * limit)
				.limit(limit)
				.lean(),
			Exercise.countDocuments(filter),
		]);

		const exercises = await Promise.all(rows.map(withSignedImages));

		res.status(200).json({
			exercises,
			pagination: {
				page,
				limit,
				total,
				totalPages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("[listExercises] 500 Error:", error);
		next(error);
	}
};

export const getExerciseById: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const exercise = await Exercise.findById(id).lean();
		if (!exercise || exercise.isDeleted) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (!exercise.isSystem && exercise.createdBy?.toString() !== requester.id) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		res.status(200).json(await withSignedImages(exercise));
	} catch (error) {
		next(error);
	}
};

export const createExercise: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const parsed = createExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const exercise = await Exercise.create({
			...parsed.data,
			muscleGroups: parsed.data
				.muscleGroups as import("../models/Enums").MuscleGroup[],
			difficulty: parsed.data
				.difficulty as import("../models/Enums").ExerciseDifficulty,
			sectionTypes: parsed.data.sectionTypes as any,
			isSystem: requester.role === "admin",
			createdBy: new mongoose.Types.ObjectId(requester.id),
		});

		res.status(201).json(exercise);
	} catch (error) {
		next(error);
	}
};

export const updateExercise: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const parsed = updateExerciseBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.issues,
			});
			return;
		}

		const exercise = await Exercise.findById(id);
		if (!exercise || exercise.isDeleted) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (exercise.isSystem) {
			res.status(403).json({ message: "Cannot modify a system exercise" });
			return;
		}

		if (exercise.createdBy?.toString() !== requester.id) {
			res
				.status(403)
				.json({ message: "Not authorized to modify this exercise" });
			return;
		}

		const updated = await Exercise.findByIdAndUpdate(id, parsed.data, {
			new: true,
		});

		res.status(200).json(updated);
	} catch (error) {
		next(error);
	}
};

export const deleteExercise: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester) {
			res.status(401).json({ message: "Unauthorized" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ message: "Invalid exercise ID" });
			return;
		}

		const exercise = await Exercise.findById(id);
		if (!exercise || exercise.isDeleted) {
			res.status(404).json({ message: "Exercise not found" });
			return;
		}

		if (exercise.isSystem) {
			res.status(403).json({ message: "Cannot delete a system exercise" });
			return;
		}

		if (exercise.createdBy?.toString() !== requester.id) {
			res.status(403).json({
				message: "Not authorized to delete this exercise",
			});
			return;
		}

		// Soft delete — see the note on `isDeleted` in models/Exercise.ts. A hard
		// delete here is what orphaned the plan and assignment rows that render
		// as "Deleted exercise"; the document has to stay so those joins resolve.
		exercise.isDeleted = true;
		await exercise.save();

		res.status(200).json({ message: "Exercise deleted" });
	} catch (error) {
		next(error);
	}
};
