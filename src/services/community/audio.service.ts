import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { communityConfig } from "../../config/community";
import { validateFileSignature } from "../../middleware/upload.middleware";
import { uploadToS3 } from "../../utils/s3.service";

const AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp4", "audio/aac"];

const EXTENSION_BY_MIME: Record<string, string> = {
	"audio/mpeg": ".mp3",
	"audio/mp4": ".m4a",
	"audio/aac": ".aac",
};

export class AudioUploadError extends Error {
	status: number;
	code: string;
	constructor(message: string, status = 400, code = "BAD_REQUEST") {
		super(message);
		this.name = "AudioUploadError";
		this.status = status;
		this.code = code;
	}
}

export interface AudioUploadFile {
	path: string;
	mimetype: string;
	size: number;
	originalname: string;
}

export interface UploadedAudio {
	url: string;
	mimeType: string;
	bytes: number;
	duration: number;
}

/**
 * Validate one audio clip by declared MIME + magic bytes, enforce size and
 * duration ceilings, and upload it to S3. The duration is client-declared —
 * we treat it as untrusted (bounded by the cap) rather than re-parsing the
 * container on the server.
 */
export async function processAndUploadAudio(
	file: AudioUploadFile,
	declaredDurationSeconds: number,
): Promise<UploadedAudio> {
	const mime = file.mimetype.toLowerCase();

	if (!AUDIO_MIME_TYPES.includes(mime)) {
		throw new AudioUploadError(
			`Only audio clips are allowed (mp3, m4a, aac). Rejected: ${file.mimetype}`,
			415,
			"UNSUPPORTED_MEDIA_TYPE",
		);
	}

	if (file.size > communityConfig.maxAudioBytes) {
		throw new AudioUploadError(
			`Audio exceeds the ${communityConfig.maxAudioBytes}-byte limit`,
			413,
			"PAYLOAD_TOO_LARGE",
		);
	}

	if (
		!Number.isFinite(declaredDurationSeconds) ||
		declaredDurationSeconds <= 0
	) {
		throw new AudioUploadError(
			"Audio duration is required and must be positive",
			400,
			"INVALID_AUDIO_DURATION",
		);
	}
	if (declaredDurationSeconds > communityConfig.maxAudioDurationSeconds) {
		throw new AudioUploadError(
			`Audio clip must be ${communityConfig.maxAudioDurationSeconds}s or shorter`,
			400,
			"AUDIO_TOO_LONG",
		);
	}

	// Magic-number check: a video renamed .mp3 (declared audio/mpeg) fails here.
	const signatureOk = await validateFileSignature(file.path, mime);
	if (!signatureOk) {
		throw new AudioUploadError(
			"File content does not match an allowed audio type",
			400,
			"INVALID_AUDIO",
		);
	}

	const uuid = randomUUID();
	const ext = EXTENSION_BY_MIME[mime] ?? "";
	const key = `posts/audio/${uuid}${ext}`;
	const buffer = await readFile(file.path);
	await uploadToS3(key, buffer, mime);

	return {
		url: key,
		mimeType: mime,
		bytes: file.size,
		duration: Math.round(declaredDurationSeconds),
	};
}
