import { randomUUID } from "node:crypto";
import { Jimp } from "jimp";
import { communityConfig } from "../../config/community";
import { validateFileSignature } from "../../middleware/upload.middleware";
import { uploadToS3 } from "../../utils/s3.service";

/** Declared MIME types accepted by the image endpoint (video is rejected). */
const IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

/** Carries an HTTP status + code so the controller can respond cleanly. */
export class ImageUploadError extends Error {
	status: number;
	code: string;
	constructor(message: string, status = 400, code = "BAD_REQUEST") {
		super(message);
		this.name = "ImageUploadError";
		this.status = status;
		this.code = code;
	}
}

/** A multer disk-storage file (only the fields we use). */
export interface UploadFile {
	path: string;
	mimetype: string;
	size: number;
	originalname: string;
}

/**
 * The stored reference persisted into post_media (S3 keys, not signed URLs —
 * signing happens on read, matching the existing private-bucket pattern) plus
 * signed preview URLs the client can render immediately.
 */
export interface UploadedImage {
	url: string; // S3 key of the feed-sized variant (primary)
	thumbnailUrl: string; // S3 key of the thumbnail variant
	fullUrl: string; // S3 key of the full-size variant
	blurredUrl: string; // S3 key of the blurred variant (locked-post placeholder)
	position: number;
	width: number;
	height: number;
	bytes: number;
}

/**
 * Validate one image by CONTENT (magic bytes, not extension), generate
 * thumbnail/feed/full variants, and upload all three to S3. Returns the stored
 * references. Throws {@link ImageUploadError} on any validation failure.
 */
export async function processAndUploadImage(
	file: UploadFile,
	position: number,
): Promise<UploadedImage> {
	const mime = file.mimetype.toLowerCase();

	// Reject video and any non-image declared type up front.
	if (!IMAGE_MIME_TYPES.includes(mime)) {
		throw new ImageUploadError(
			`Only images are allowed (jpeg, png, webp). Rejected: ${file.mimetype}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	if (file.size > communityConfig.maxImageBytes) {
		throw new ImageUploadError(
			`Image exceeds the ${communityConfig.maxImageBytes}-byte limit`,
			413,
			"PAYLOAD_TOO_LARGE",
		);
	}

	// Content sniffing: a video renamed .jpg (declared image/jpeg) fails here.
	const expected = mime === "image/jpg" ? "image/jpeg" : mime;
	const signatureOk = await validateFileSignature(file.path, expected);
	if (!signatureOk) {
		throw new ImageUploadError(
			"File content does not match an allowed image type",
			400,
			"INVALID_IMAGE",
		);
	}

	let image: Awaited<ReturnType<typeof Jimp.read>>;
	try {
		image = await Jimp.read(file.path);
	} catch {
		throw new ImageUploadError("Image could not be decoded", 400, "INVALID_IMAGE");
	}

	const width = image.width;
	const height = image.height;
	const uuid = randomUUID();
	const baseKey = `community/posts/images/${uuid}`;

	const fullBuf = await image.clone().getBuffer("image/jpeg", { quality: 90 });

	const feedImg = image.clone();
	if (feedImg.width > communityConfig.imageVariants.feed) {
		feedImg.resize({ w: communityConfig.imageVariants.feed });
	}
	const feedBuf = await feedImg.getBuffer("image/jpeg", { quality: 82 });

	const thumbImg = image.clone();
	if (thumbImg.width > communityConfig.imageVariants.thumbnail) {
		thumbImg.resize({ w: communityConfig.imageVariants.thumbnail });
	}
	const thumbBuf = await thumbImg.getBuffer("image/jpeg", { quality: 75 });

	// Blurred placeholder: downscale hard, then blur — detail is unrecoverable,
	// so this is safe to serve to a non-member on a locked post.
	const blurImg = image.clone().resize({ w: 64 });
	blurImg.blur(6);
	const blurBuf = await blurImg.getBuffer("image/jpeg", { quality: 40 });

	const fullKey = `${baseKey}/full.jpg`;
	const feedKey = `${baseKey}/feed.jpg`;
	const thumbKey = `${baseKey}/thumb.jpg`;
	const blurKey = `${baseKey}/blur.jpg`;

	await Promise.all([
		uploadToS3(fullKey, fullBuf, "image/jpeg"),
		uploadToS3(feedKey, feedBuf, "image/jpeg"),
		uploadToS3(thumbKey, thumbBuf, "image/jpeg"),
		uploadToS3(blurKey, blurBuf, "image/jpeg"),
	]);

	return {
		url: feedKey,
		thumbnailUrl: thumbKey,
		fullUrl: fullKey,
		blurredUrl: blurKey,
		position,
		width,
		height,
		bytes: file.size,
	};
}
