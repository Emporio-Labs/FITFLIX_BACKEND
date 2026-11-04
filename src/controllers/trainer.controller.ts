import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import type { RequestHandler } from "express";
import { Jimp } from "jimp";
import { validateFileSignature } from "../middleware/upload.middleware";
import { uploadToS3 } from "../utils/s3.service";
import mongoose from "mongoose";
import Trainer from "../models/Trainer";
import User from "../models/User";
import {
	assertTrainerOwnsMember,
	getRosterUserIds,
} from "../services/trainerRoster.service";
import { hashPassword } from "../utils/password";
import { normalizeRole } from "../middleware/rbac.middleware";
import {
	LocationError,
	mapLocationError,
	resolveLocationId,
} from "../utils/location.resolver";
import { branchFilter } from "../utils/branch-scope";

const sendLocationError = (
	res: Parameters<RequestHandler>[1],
	error: LocationError,
) => {
	const mapped = mapLocationError(error);
	res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
};
import { isEmailInUseAcrossSystem } from "../utils/email-uniqueness";
import {
	createTrainerBodySchema,
	updateTrainerBodySchema,
} from "../validators/trainer.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const toPublicTrainerResponse = (trainer: {
	_id: mongoose.Types.ObjectId;
	trainerName: string;
	description: string;
	specialities: string[];
	certifications?: string[];
	imageUrl?: string;
	keySentence?: string;
	isActive?: boolean;
}) => ({
	_id: trainer._id,
	name: trainer.trainerName,
	description: trainer.description,
	specialities: trainer.specialities,
	certifications: trainer.certifications || [],
	imageUrl: trainer.imageUrl || "",
	keySentence: trainer.keySentence || "",
	isActive: trainer.isActive !== false,
});

export const createTrainer: RequestHandler = async (req, res, next) => {
	const parsedBody = createTrainerBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid trainer payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	try {
		const { password, ...rest } = parsedBody.data;

		if (rest.email) {
			const emailCheck = await isEmailInUseAcrossSystem(rest.email);
			if (emailCheck.exists) {
				res.status(409).json({ message: `An account with this email already exists as a ${emailCheck.accountType}` });
				return;
			}
		}

		const { locationId, ...fields } = rest;
		const passwordHash = await hashPassword(password);
		const trainer = await Trainer.create({
			...fields,
			// Left out, the location-stamp plugin applies the default branch.
			...(locationId !== undefined
				? { locationId: locationId && (await resolveLocationId(locationId)) }
				: {}),
			passwordHash,
		});
		res.status(201).json({ message: "Trainer created", trainer });
	} catch (error) {
		if (error instanceof LocationError) {
			sendLocationError(res, error);
			return;
		}
		next(error);
	}
};

export const getAllTrainers: RequestHandler = async (req, res, next) => {
	try {
		const trainers = await Trainer.find(await branchFilter(req));
		res.status(200).json({ trainers });
	} catch (error) {
		next(error);
	}
};

export const getPublicTrainers: RequestHandler = async (_req, res, next) => {
	try {
		const trainers = await Trainer.find({ isActive: { $ne: false } }).select(
			"trainerName description specialities certifications imageUrl keySentence isActive",
		);
		res.status(200).json({ trainers: trainers.map(toPublicTrainerResponse) });
	} catch (error) {
		next(error);
	}
};

export const getTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const trainer = await Trainer.findById(id);

		if (!trainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ trainer });
	} catch (error) {
		next(error);
	}
};

export const getPublicTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const trainer = await Trainer.findOne({ _id: id, isActive: { $ne: false } }).select(
			"trainerName description specialities certifications imageUrl keySentence isActive",
		);

		if (!trainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ trainer: toPublicTrainerResponse(trainer) });
	} catch (error) {
		next(error);
	}
};

export const updateTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	const parsedBody = updateTrainerBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid trainer update payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { password, locationId, canAccessLeads, ...rest } = parsedBody.data;
	const hashedPassword = password ? await hashPassword(password) : null;

	try {
		// Which branch a trainer works at, and whether they may work leads,
		// are admin decisions; a trainer editing their own profile can't
		// change either.
		const isAdminCaller =
			Boolean(req.user) && normalizeRole(req.user!.role) === "admin";
		if (!isAdminCaller && req.user?.id !== id) {
			res.status(403).json({ message: "Forbidden: Trainers can only edit their own profile", code: "FORBIDDEN" });
			return;
		}
		const branchPatch =
			locationId !== undefined && isAdminCaller
				? { locationId: locationId && (await resolveLocationId(locationId)) }
				: {};
		const updatePayload = {
			...rest,
			...branchPatch,
			...(canAccessLeads !== undefined && isAdminCaller
				? { canAccessLeads }
				: {}),
			...(hashedPassword ? { passwordHash: hashedPassword } : {}),
		};

		if (rest.email) {
			const emailCheck = await isEmailInUseAcrossSystem(rest.email, id);
			if (emailCheck.exists) {
				res.status(409).json({ message: `An account with this email already exists as a ${emailCheck.accountType}` });
				return;
			}
		}

		const updatedTrainer = await Trainer.findByIdAndUpdate(id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		});

		if (!updatedTrainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res
			.status(200)
			.json({ message: "Trainer updated", trainer: updatedTrainer });
	} catch (error) {
		if (error instanceof LocationError) {
			sendLocationError(res, error);
			return;
		}
		next(error);
	}
};

// ── GET /trainers/me ─────────────────────────────────────────────────────────
// Authenticated trainer retrieves their own profile with populated location.
export const getMyTrainerProfile: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester || requester.role !== "trainer") {
		res.status(403).json({ error: "Forbidden: Only trainers can access their profile", code: "FORBIDDEN" });
		return;
	}

	try {
		const trainer = await Trainer.findById(requester.id).populate("locationId", "name code address timezone");
		if (!trainer) {
			res.status(404).json({ error: "Trainer profile not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ trainer });
	} catch (error) {
		next(error);
	}
};

// ── PATCH /trainers/me ───────────────────────────────────────────────────────
// Authenticated trainer updates their own profile (name, phone, bio, specialities, photo, password).
export const updateMyTrainerProfile: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester || requester.role !== "trainer") {
		res.status(403).json({ error: "Forbidden: Only trainers can update their profile", code: "FORBIDDEN" });
		return;
	}

	const parsedBody = updateTrainerBodySchema.safeParse(req.body);
	if (!parsedBody.success) {
		res.status(400).json({
			error: "Invalid trainer update payload",
			code: "VALIDATION_ERROR",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const { password, locationId: _loc, canAccessLeads: _cal, ...rest } = parsedBody.data;
	const hashedPassword = password ? await hashPassword(password) : null;

	try {
		if (rest.email) {
			const emailCheck = await isEmailInUseAcrossSystem(rest.email, requester.id);
			if (emailCheck.exists) {
				res.status(409).json({ message: `An account with this email already exists as a ${emailCheck.accountType}` });
				return;
			}
		}

		const updatePayload = {
			...rest,
			...(hashedPassword ? { passwordHash: hashedPassword } : {}),
		};

		const updatedTrainer = await Trainer.findByIdAndUpdate(requester.id, updatePayload, {
			returnDocument: "after",
			runValidators: true,
		}).populate("locationId", "name code address timezone");

		if (!updatedTrainer) {
			res.status(404).json({ error: "Trainer not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ message: "Profile updated successfully", trainer: updatedTrainer });
	} catch (error) {
		next(error);
	}
};

// ── POST /trainers/upload-image ──────────────────────────────────────────────
// Upload and square-crop a trainer avatar / profile image to S3 or local storage.
export const uploadTrainerImage: RequestHandler = async (req, res, next) => {
	const file = req.file;
	if (!file) {
		res.status(400).json({ error: "No image file provided", code: "VALIDATION_ERROR" });
		return;
	}

	try {
		const mime = file.mimetype.toLowerCase();
		const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
		if (!allowedMimes.includes(mime)) {
			res.status(415).json({
				error: "Only JPG, PNG or WebP images are allowed",
				code: "UNSUPPORTED_MEDIA_TYPE",
			});
			return;
		}

		if (file.size > 30 * 1024 * 1024) {
			res.status(413).json({
				error: "Image must be 30 MB or smaller",
				code: "PAYLOAD_TOO_LARGE",
			});
			return;
		}

		const expected = mime === "image/jpg" ? "image/jpeg" : mime;
		const signatureOk = await validateFileSignature(file.path, expected);
		if (!signatureOk) {
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
			res.status(400).json({ error: "Image could not be decoded", code: "INVALID_IMAGE" });
			return;
		}

		// Centre-crop to square for profile picture
		const edge = Math.min(image.width, image.height);
		const square = image.crop({
			x: Math.floor((image.width - edge) / 2),
			y: Math.floor((image.height - edge) / 2),
			w: edge,
			h: edge,
		});

		if (square.width > 1200) {
			square.resize({ w: 1200, h: 1200 });
		}

		const buffer = await square.getBuffer("image/jpeg", { quality: 92 });
		const imageKey = `trainers/avatars/${randomUUID()}.jpg`;
		const uploadResult = await uploadToS3(imageKey, buffer, "image/jpeg");

		res.status(201).json({
			message: "Trainer image uploaded successfully",
			imageUrl: uploadResult.url,
			s3Key: uploadResult.s3Key,
		});
	} catch (error) {
		next(error);
	} finally {
		if (file) await unlink(file.path).catch(() => {});
	}
};

// ── GET /trainers/me/members ───────────────────────────────────────────────
// Members currently assigned to the authenticated trainer.

export const getMyMembers: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		const rosterIds = await getRosterUserIds(requester.id);
		const members = await User.find({ _id: { $in: rosterIds } })
			.select("username phone email age gender onboarded assignedTrainerAt")
			.sort({ username: 1 })
			.lean();

		res.status(200).json({ members });
	} catch (error) {
		next(error);
	}
};

// ── GET /trainers/me/members/:userId ───────────────────────────────────────
// A single roster member's profile. Trainers may only fetch their own
// roster; admins bypass the roster check.

export const getMyMemberById: RequestHandler = async (req, res, next) => {
	const requester = req.user;
	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const userId = getIdParam(req.params.userId);
	if (!userId) {
		res.status(400).json({ message: "Invalid member id" });
		return;
	}

	try {
		if (requester.role === "trainer") {
			await assertTrainerOwnsMember(requester.id, userId);
		}

		const member = await User.findById(userId).select(
			"username phone email age gender onboarded assignedTrainer assignedTrainerAt",
		);

		if (!member) {
			res.status(404).json({ message: "Member not found" });
			return;
		}

		res.status(200).json({ member });
	} catch (error) {
		next(error);
	}
};

export const deleteTrainerById: RequestHandler = async (req, res, next) => {
	const id = getIdParam(req.params.id);

	if (!id) {
		res.status(400).json({ message: "Invalid trainer id" });
		return;
	}

	try {
		const deletedTrainer = await Trainer.findByIdAndDelete(id);

		if (!deletedTrainer) {
			res.status(404).json({ message: "Trainer not found" });
			return;
		}

		res.status(200).json({ message: "Trainer deleted" });
	} catch (error) {
		next(error);
	}
};
