import { randomUUID } from "node:crypto";
import path from "node:path";
import { communityConfig } from "../../config/community";
import {
	generatePresignedPutUrl,
	headS3Object,
} from "../../utils/s3.service";

export const VIDEO_MIME_TYPES = [
	"video/mp4",
	"video/webm",
	"video/quicktime",
] as const;

export type VideoMimeType = (typeof VIDEO_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<VideoMimeType, string> = {
	"video/mp4": ".mp4",
	"video/webm": ".webm",
	"video/quicktime": ".mov",
};

export class VideoUploadError extends Error {
	status: number;
	code: string;
	constructor(message: string, status = 400, code = "BAD_REQUEST") {
		super(message);
		this.name = "VideoUploadError";
		this.status = status;
		this.code = code;
	}
}

export interface VideoPresignResult {
	uploadUrl: string;
	s3Key: string;
	contentType: VideoMimeType;
	expiresAt: string;
}

/**
 * Only S3 keys under this prefix are accepted when a client references an
 * uploaded video on post creation — prevents pointing at arbitrary objects.
 */
export const VIDEO_KEY_PREFIX = "community/posts/videos/";

const isVideoMime = (mime: string): mime is VideoMimeType =>
	(VIDEO_MIME_TYPES as readonly string[]).includes(mime);

export async function presignVideoUpload(params: {
	filename: string;
	contentType: string;
	contentLength: number;
}): Promise<VideoPresignResult> {
	const mime = params.contentType.toLowerCase();
	if (!isVideoMime(mime)) {
		throw new VideoUploadError(
			`Unsupported video type: ${params.contentType}. Allowed: ${VIDEO_MIME_TYPES.join(", ")}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}
	if (!Number.isFinite(params.contentLength) || params.contentLength <= 0) {
		throw new VideoUploadError("contentLength must be a positive number");
	}
	if (params.contentLength > communityConfig.maxVideoBytes) {
		throw new VideoUploadError(
			`Video exceeds the ${communityConfig.maxVideoBytes}-byte limit`,
			413,
			"PAYLOAD_TOO_LARGE",
		);
	}

	const ext =
		EXTENSION_BY_MIME[mime] ||
		path.extname(params.filename).toLowerCase() ||
		".mp4";
	const key = `${VIDEO_KEY_PREFIX}${randomUUID()}${ext}`;

	const uploadUrl = await generatePresignedPutUrl(
		key,
		mime,
		params.contentLength,
		communityConfig.videoPresignedUrlTtlSeconds,
	);

	const expiresAt = new Date(
		Date.now() + communityConfig.videoPresignedUrlTtlSeconds * 1000,
	).toISOString();

	return { uploadUrl, s3Key: key, contentType: mime, expiresAt };
}

export interface ValidatedVideo {
	s3Key: string;
	contentType: VideoMimeType;
	contentLength: number;
}

/**
 * Verify the client actually uploaded a video at the given key: object exists,
 * is under our prefix, is under the size cap, and declares an allowed MIME.
 * Called during post creation to prevent the client from attaching an arbitrary
 * (or missing) S3 object.
 */
export async function validateUploadedVideo(
	s3Key: string,
): Promise<ValidatedVideo> {
	if (!s3Key.startsWith(VIDEO_KEY_PREFIX)) {
		throw new VideoUploadError(
			"s3Key must reference a community video upload",
			400,
			"INVALID_VIDEO_KEY",
		);
	}

	const head = await headS3Object(s3Key);
	if (!head) {
		throw new VideoUploadError(
			`Video not found at s3Key: ${s3Key}`,
			404,
			"NOT_FOUND",
		);
	}

	const mime = (head.contentType ?? "").toLowerCase();
	if (!isVideoMime(mime)) {
		throw new VideoUploadError(
			`Uploaded object has unsupported content-type: ${head.contentType ?? "unknown"}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	const bytes = head.contentLength ?? 0;
	if (bytes <= 0) {
		throw new VideoUploadError("Uploaded video is empty");
	}
	if (bytes > communityConfig.maxVideoBytes) {
		throw new VideoUploadError(
			`Uploaded video exceeds the ${communityConfig.maxVideoBytes}-byte limit`,
			413,
			"PAYLOAD_TOO_LARGE",
		);
	}

	return { s3Key, contentType: mime, contentLength: bytes };
}
