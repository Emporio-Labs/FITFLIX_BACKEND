import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { Jimp } from "jimp";
import { validateFileSignature } from "../middleware/upload.middleware";
import type ProgressPhoto from "../models/ProgressPhoto";
import { deleteFromS3, generateSignedUrl, uploadToS3 } from "../utils/s3.service";

const ACCEPTED_IMAGE_MIMES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export class ProgressPhotoServiceError extends Error {
	status: number;
	code: string;

	constructor(message: string, status = 400, code = "BAD_REQUEST") {
		super(message);
		this.name = "ProgressPhotoServiceError";
		this.status = status;
		this.code = code;
	}
}

export interface UploadedProgressFile {
	path: string;
	mimetype: string;
	size: number;
	originalname: string;
}

export interface ProcessedPhotoResult {
	s3Key: string;
	thumbnailKey: string;
	url: string;
	thumbnailUrl: string;
}

/**
 * Normalizes any valid date string or Date object to the start of the UTC calendar day.
 * Ensures consistent day grouping regardless of server or client timezone offsets.
 */
export const normalizeToDayStart = (dateInput?: string | Date): Date => {
	const d = dateInput ? new Date(dateInput) : new Date();
	if (Number.isNaN(d.getTime())) {
		throw new ProgressPhotoServiceError("Invalid date provided", 400, "INVALID_DATE");
	}
	return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
};

/**
 * Validates file signature, resizes images into full & thumbnail variants,
 * uploads to private S3 storage, and cleans up the temporary disk file.
 */
export const processAndUploadProgressPhoto = async (
	userId: string,
	pose: string,
	recordedDate: Date,
	file: UploadedProgressFile,
): Promise<ProcessedPhotoResult> => {
	const mime = file.mimetype.toLowerCase();

	if (!ACCEPTED_IMAGE_MIMES.includes(mime)) {
		throw new ProgressPhotoServiceError(
			`Only JPEG, PNG, and WEBP image files are allowed. Received: ${file.mimetype}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	const expectedMime = mime === "image/jpg" ? "image/jpeg" : mime;
	const signatureMatches = await validateFileSignature(file.path, expectedMime);
	if (!signatureMatches) {
		throw new ProgressPhotoServiceError(
			"File content does not match the declared image type",
			400,
			"INVALID_IMAGE_SIGNATURE",
		);
	}

	let jimpImage: Awaited<ReturnType<typeof Jimp.read>>;
	try {
		jimpImage = await Jimp.read(file.path);
	} catch {
		throw new ProgressPhotoServiceError("Failed to decode uploaded image", 400, "IMAGE_DECODE_FAILED");
	} finally {
		// Always remove the multer temp file from disk
		await unlink(file.path).catch(() => {});
	}

	const dateStr = recordedDate.toISOString().slice(0, 10);
	const uuid = randomUUID();
	const baseKey = `progress-photos/${userId}/${dateStr}_${pose}_${uuid}`;
	const fullKey = `${baseKey}_full.jpg`;
	const thumbKey = `${baseKey}_thumb.jpg`;

	// Full size variant: cap width to 1600px, JPEG quality 85
	const fullImg = jimpImage.clone();
	if (fullImg.width > 1600) {
		fullImg.resize({ w: 1600 });
	}
	const fullBuffer = await fullImg.getBuffer("image/jpeg", { quality: 85 });

	// Thumbnail variant: cap width to 400px, JPEG quality 75
	const thumbImg = jimpImage.clone();
	if (thumbImg.width > 400) {
		thumbImg.resize({ w: 400 });
	}
	const thumbBuffer = await thumbImg.getBuffer("image/jpeg", { quality: 75 });

	await Promise.all([
		uploadToS3(fullKey, fullBuffer, "image/jpeg"),
		uploadToS3(thumbKey, thumbBuffer, "image/jpeg"),
	]);

	const [url, thumbnailUrl] = await Promise.all([
		generateSignedUrl(fullKey, 900, "image/jpeg"),
		generateSignedUrl(thumbKey, 900, "image/jpeg"),
	]);

	return {
		s3Key: fullKey,
		thumbnailKey: thumbKey,
		url,
		thumbnailUrl,
	};
};

/**
 * Permanently removes full photo and thumbnail from S3.
 */
export const deletePhotoStorage = async (s3Key: string, thumbnailKey: string): Promise<void> => {
	await Promise.all([deleteFromS3(s3Key), deleteFromS3(thumbnailKey)]);
};

/**
 * Enriches a raw photo document or object with fresh presigned URLs.
 */
export const enrichPhotoWithUrls = async (photo: any): Promise<any> => {
	const [url, thumbnailUrl] = await Promise.all([
		generateSignedUrl(photo.s3Key, 900, "image/jpeg"),
		generateSignedUrl(photo.thumbnailKey, 900, "image/jpeg"),
	]);

	const obj = typeof photo.toObject === "function" ? photo.toObject() : { ...photo };
	return {
		...obj,
		url,
		thumbnailUrl,
	};
};
