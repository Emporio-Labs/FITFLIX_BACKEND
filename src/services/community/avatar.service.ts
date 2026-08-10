import { randomUUID } from "node:crypto";
import { Jimp } from "jimp";
import { communityConfig } from "../../config/community";
import { validateFileSignature } from "../../middleware/upload.middleware";
import { uploadToS3 } from "../../utils/s3.service";
import type { UploadFile } from "./image.service";

/** Declared MIME types accepted by the avatar endpoint. */
const AVATAR_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

/** Carries an HTTP status + code so the controller can respond cleanly.
 *  Same contract as {@link ImageUploadError}. */
export class AvatarUploadError extends Error {
	status: number;
	code: string;
	constructor(message: string, status = 400, code = "BAD_REQUEST") {
		super(message);
		this.name = "AvatarUploadError";
		this.status = status;
		this.code = code;
	}
}

export interface UploadedAvatar {
	/** S3 key of the square full-size avatar. */
	avatarKey: string;
	/** S3 key of the square thumbnail used in feeds, comments and lists. */
	avatarThumbKey: string;
	bytes: number;
}

/**
 * Validate, square-crop and upload one avatar.
 *
 * Deliberately NOT `processAndUploadImage`: that produces four
 * aspect-preserving variants for a post. An avatar has to be a square centre
 * crop, and the Flutter client has no cropper dependency, so the crop happens
 * here.
 *
 * The S3 key embeds a FRESH UUID on every upload, so replacing an avatar never
 * overwrites the previous object. That is load-bearing, not cosmetic: the app's
 * `stableImageCacheKey` strips the presigned signature and keys its disk cache
 * on the object PATH, so an overwritten key would serve the old photo forever
 * on every device with no way to invalidate it. A new path is a guaranteed
 * cache miss.
 */
export async function processAndUploadAvatar(
	file: UploadFile,
	ownerId: string,
): Promise<UploadedAvatar> {
	const mime = file.mimetype.toLowerCase();

	if (!AVATAR_MIME_TYPES.includes(mime)) {
		throw new AvatarUploadError(
			`Only images are allowed (jpeg, png, webp). Rejected: ${file.mimetype}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	if (file.size > communityConfig.maxImageBytes) {
		throw new AvatarUploadError(
			`Image exceeds the ${communityConfig.maxImageBytes}-byte limit`,
			413,
			"PAYLOAD_TOO_LARGE",
		);
	}

	// Content sniffing: a video renamed .jpg (declared image/jpeg) fails here.
	const expected = mime === "image/jpg" ? "image/jpeg" : mime;
	const signatureOk = await validateFileSignature(file.path, expected);
	if (!signatureOk) {
		throw new AvatarUploadError(
			"File content does not match an allowed image type",
			400,
			"INVALID_IMAGE",
		);
	}

	let image: Awaited<ReturnType<typeof Jimp.read>>;
	try {
		image = await Jimp.read(file.path);
	} catch {
		throw new AvatarUploadError(
			"Image could not be decoded",
			400,
			"INVALID_IMAGE",
		);
	}

	// Centre-crop to a square before resizing, so a portrait selfie keeps the
	// middle of the frame instead of being squashed.
	const edge = Math.min(image.width, image.height);
	const square = image
		.clone()
		.crop({
			x: Math.floor((image.width - edge) / 2),
			y: Math.floor((image.height - edge) / 2),
			w: edge,
			h: edge,
		});

	const fullPx = communityConfig.avatarVariants.full;
	const thumbPx = communityConfig.avatarVariants.thumb;

	const fullImg = square.clone();
	// Never upscale — a 200px source stays 200px rather than being blown up.
	if (fullImg.width > fullPx) fullImg.resize({ w: fullPx, h: fullPx });
	const fullBuf = await fullImg.getBuffer("image/jpeg", { quality: 88 });

	const thumbImg = square.clone();
	if (thumbImg.width > thumbPx) thumbImg.resize({ w: thumbPx, h: thumbPx });
	const thumbBuf = await thumbImg.getBuffer("image/jpeg", { quality: 78 });

	const baseKey = `community/profiles/avatars/${ownerId}/${randomUUID()}`;
	const avatarKey = `${baseKey}/avatar.jpg`;
	const avatarThumbKey = `${baseKey}/thumb.jpg`;

	await Promise.all([
		uploadToS3(avatarKey, fullBuf, "image/jpeg"),
		uploadToS3(avatarThumbKey, thumbBuf, "image/jpeg"),
	]);

	return { avatarKey, avatarThumbKey, bytes: file.size };
}
