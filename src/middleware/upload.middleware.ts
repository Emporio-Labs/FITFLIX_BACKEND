import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { communityConfig } from "../config/community";

const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"audio/mpeg",
	"audio/mp4",
	"audio/aac",
];

/** Accepted MIME types for general file attachments (images + documents + video + audio). */
const ALLOWED_FILE_MIME_TYPES = [
	// Images
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
	"image/gif",
	// Documents
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"text/plain",
	// Video
	"video/mp4",
	"video/quicktime",
	"video/x-msvideo",
	"video/webm",
	// Audio
	"audio/mpeg",
	"audio/mp3",
	"audio/wav",
	"audio/ogg",
	"audio/aac",
	"audio/flac",
	"audio/x-m4a",
	"audio/mp4",
];

export const uploadMiddleware = multer({
	storage: multer.diskStorage({
		destination: os.tmpdir(),
		filename: (_req, file, cb) => {
			const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
			cb(
				null,
				`${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`,
			);
		},
	}),
	limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
	fileFilter: (_req, file, cb) => {
		if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
			cb(null, true);
			return;
		}

		cb(new Error(`Unsupported file type: ${file.mimetype}`));
	},
});

const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac"];

/**
 * Multer instance for community audio uploads. Size ceiling comes from
 * communityConfig.maxAudioBytes so the ops-tunable cap and multer stay aligned.
 */
export const audioUploadMiddleware = multer({
	storage: multer.diskStorage({
		destination: os.tmpdir(),
		filename: (_req, file, cb) => {
			const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
			cb(
				null,
				`${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`,
			);
		},
	}),
	limits: { fileSize: communityConfig.maxAudioBytes },
	fileFilter: (_req, file, cb) => {
		if (AUDIO_MIME_TYPES.includes(file.mimetype)) {
			cb(null, true);
			return;
		}
		cb(new Error(`Unsupported audio type: ${file.mimetype}`));
	},
});

/**
 * Multer instance for general file uploads (images, PDF, DOCX, video, etc.).
 * 50 MB limit per file; up to 10 files per request.
 */
export const fileUploadMiddleware = multer({
	storage: multer.diskStorage({
		destination: os.tmpdir(),
		filename: (_req, file, cb) => {
			const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
			cb(
				null,
				`${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`,
			);
		},
	}),
	limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
	fileFilter: (_req, file, cb) => {
		if (ALLOWED_FILE_MIME_TYPES.includes(file.mimetype)) {
			cb(null, true);
			return;
		}
		cb(new Error(`Unsupported file type: ${file.mimetype}`));
	},
});

/**
 * Validates the actual binary signature (magic numbers) of the file on disk
 * against its expected MIME type to prevent extension-spoofing attacks.
 */
export const validateFileSignature = async (
	filePath: string,
	expectedMimeType: string,
): Promise<boolean> => {
	let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		fileHandle = await open(filePath, "r");
		const buffer = Buffer.alloc(12);
		await fileHandle.read(buffer, 0, 12, 0);

		const hex = buffer.toString("hex").toUpperCase();
		const mimeLower = expectedMimeType.toLowerCase();

		if (mimeLower === "application/pdf") {
			// PDF signature: %PDF (25 50 44 46)
			return hex.startsWith("25504446");
		}

		if (mimeLower === "image/jpeg" || mimeLower === "image/jpg") {
			// JPEG signature: FF D8 FF
			return hex.startsWith("FFD8FF");
		}

		if (mimeLower === "image/png") {
			// PNG signature: 89 50 4E 47 0D 0A 1A 0A
			return hex.startsWith("89504E470D0A1A0A");
		}

		if (mimeLower === "image/webp") {
			// WEBP signature: RIFF (52 49 46 46) at 0, WEBP (57 45 42 50) at 8
			return hex.startsWith("52494646") && hex.slice(16, 24) === "57454250";
		}

		if (mimeLower === "audio/mpeg") {
			// MP3 with ID3v2 tag: "ID3" (49 44 33)
			if (hex.startsWith("494433")) return true;
			// Raw MPEG audio frame sync: first 11 bits set (FF Ex/Fx) with a valid
			// version (bits 4-3 ≠ 01) and layer (bits 2-1 ≠ 00).
			const b0 = buffer[0] ?? 0;
			const b1 = buffer[1] ?? 0;
			if (b0 === 0xff && (b1 & 0xe0) === 0xe0) {
				const version = (b1 & 0x18) >> 3;
				const layer = (b1 & 0x06) >> 1;
				return version !== 1 && layer !== 0;
			}
			return false;
		}

		if (mimeLower === "audio/mp4") {
			// M4A / MP4 audio: bytes 4-7 are "ftyp" (66 74 79 70). Any brand is
			// accepted; the declared audio MIME asserts the intended content type.
			return hex.slice(8, 16) === "66747970";
		}

		if (mimeLower === "audio/aac") {
			// Raw ADTS AAC: FF F1 (MPEG-4) or FF F9 (MPEG-2). Also accept an ADIF
			// header ("ADIF" = 41 44 49 46) though it is rarely produced.
			const b0 = buffer[0] ?? 0;
			const b1 = buffer[1] ?? 0;
			if (b0 === 0xff && (b1 === 0xf1 || b1 === 0xf9)) {
				return true;
			}
			return hex.startsWith("41444946");
		}

		return false;
	} catch (error) {
		console.error("[SECURITY] File signature validation error:", error);
		return false;
	} finally {
		if (fileHandle) {
			await fileHandle.close();
		}
	}
};

const uploadLimits = new Map<string, { count: number; resetTime: number }>();

// Periodically clean up rate limiter map to prevent memory leak
setInterval(
	() => {
		const now = Date.now();
		for (const [key, value] of uploadLimits.entries()) {
			if (now > value.resetTime) {
				uploadLimits.delete(key);
			}
		}
	},
	30 * 60 * 1000,
); // every 30 minutes

/**
 * Rate limiter middleware for file uploads.
 * Restricts users to a maximum of 10 uploads per 15-minute window.
 */
export const uploadRateLimiter = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	if (!req.user) {
		res
			.status(401)
			.json({ error: "Authentication required", code: "UNAUTHORIZED" });
		return;
	}

	const userId = req.user.id;
	const now = Date.now();
	const windowMs = 15 * 60 * 1000; // 15 minutes
	const maxUploads = 10; // Max 10 uploads per 15 minutes per user

	const userLimit = uploadLimits.get(userId);

	if (!userLimit) {
		uploadLimits.set(userId, { count: 1, resetTime: now + windowMs });
		next();
		return;
	}

	if (now > userLimit.resetTime) {
		userLimit.count = 1;
		userLimit.resetTime = now + windowMs;
		next();
		return;
	}

	if (userLimit.count >= maxUploads) {
		res.status(429).json({
			error: "Upload limit exceeded. Please try again in a few minutes.",
			code: "TOO_MANY_REQUESTS",
		});
		return;
	}

	userLimit.count += 1;
	next();
};
