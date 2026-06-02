import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/webp",
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
