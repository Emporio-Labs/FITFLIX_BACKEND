import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const rawRegion = process.env.AWS_REGION?.trim() ?? "ap-south-1";
const REGION =
	rawRegion && !rawRegion.startsWith("[") && rawRegion.length > 2
		? rawRegion
		: "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET ?? "fitflix-storage";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID?.trim() ?? "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? "";

const hasAwsCredentials = Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);

/**
 * Main S3 client — used for server-side PutObject / GetObject / HeadObject /
 * DeleteObject operations where the SDK can compute checksums correctly
 * because the full body is available.
 */
const s3Client = hasAwsCredentials
	? new S3Client({
			region: REGION,
			credentials: {
				accessKeyId: AWS_ACCESS_KEY_ID,
				secretAccessKey: AWS_SECRET_ACCESS_KEY,
			},
		})
	: null;

/**
 * Dedicated S3 client used ONLY for generating presigned PUT URLs.
 *
 * AWS SDK v3 (≥ 3.x) automatically appends an `x-amz-checksum-crc32`
 * parameter to PutObject presigned URLs. It computes the checksum against
 * an empty body at presign time, so when the browser PUTs the real video
 * file the checksum never matches and S3 rejects every upload with
 * "ERR_FAILED" / "failed to fetch".
 *
 * Setting `requestChecksumCalculation: 'WHEN_REQUIRED'` disables the
 * automatic checksum so the presigned URL only requires `Content-Type`,
 * which the browser reliably sends.
 */
const s3PresignClient = hasAwsCredentials
	? new S3Client({
			region: REGION,
			credentials: {
				accessKeyId: AWS_ACCESS_KEY_ID,
				secretAccessKey: AWS_SECRET_ACCESS_KEY,
			},
			// Prevents the SDK from embedding a CRC32 checksum into presigned URLs.
			// The checksum is computed against an empty body during presigning but
			// S3 validates it against the actual uploaded file — so it always fails.
			requestChecksumCalculation: "WHEN_REQUIRED",
		})
	: null;

const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

export const uploadToS3 = async (
	key: string,
	buffer: Buffer,
	contentType: string,
): Promise<{ s3Key: string }> => {
	if (s3Client) {
		try {
			await s3Client.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: key,
					Body: buffer,
					ContentType: contentType,
					ContentDisposition: "inline",
					ServerSideEncryption: "AES256",
				}),
			);
		} catch (err: any) {
			console.error("[S3_UPLOAD_ERROR] PutObject failed:", err?.message || err);
			throw new Error(
				`S3 upload failed (${err?.name || "UnknownError"}): ${err?.message || "Check AWS credentials"}`,
			);
		}
	} else {
		// Local development fallback when AWS S3 credentials are not set in .env
		const targetPath = path.join(UPLOADS_DIR, key);
		await mkdir(path.dirname(targetPath), { recursive: true });
		await writeFile(targetPath, buffer);
	}

	return {
		s3Key: key,
	};
};

export const uploadStreamToS3 = async (
	key: string,
	filePath: string,
	contentType: string,
	fileSize: number,
): Promise<{ s3Key: string }> => {
	if (s3Client) {
		try {
			const fileStream = createReadStream(filePath);
			await s3Client.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: key,
					Body: fileStream,
					ContentType: contentType,
					ContentLength: fileSize,
					ContentDisposition: "inline",
					ServerSideEncryption: "AES256",
				}),
			);
		} catch (err: any) {
			console.error("[S3_UPLOAD_ERROR] PutObject stream failed:", err?.message || err);
			throw new Error(
				`S3 stream upload failed (${err?.name || "UnknownError"}): ${err?.message || "Check AWS credentials"}`,
			);
		}
	} else {
		const targetPath = path.join(UPLOADS_DIR, key);
		await mkdir(path.dirname(targetPath), { recursive: true });
		const fileBuf = await readFile(filePath);
		await writeFile(targetPath, fileBuf);
	}

	return {
		s3Key: key,
	};
};

export const deleteFromS3 = async (key: string): Promise<void> => {
	if (s3Client) {
		try {
			await s3Client.send(
				new DeleteObjectCommand({
					Bucket: BUCKET,
					Key: key,
				}),
			);
		} catch (err: any) {
			console.error("[S3_DELETE_ERROR] DeleteObject failed:", err?.message || err);
		}
	} else {
		const targetPath = path.join(UPLOADS_DIR, key);
		await unlink(targetPath).catch(() => {});
	}
};

const SAFE_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
	"audio/mpeg",
	"audio/mp4",
	"audio/aac",
	"video/mp4",
	"video/webm",
	"video/quicktime",
];

export const generateSignedUrl = async (
	s3Key: string,
	expiresInSeconds = 900,
	contentType?: string | null,
): Promise<string> => {
	if (s3Client) {
		const safeContentType =
			contentType && SAFE_MIME_TYPES.includes(contentType.toLowerCase())
				? contentType.toLowerCase()
				: "application/octet-stream";

		const command = new GetObjectCommand({
			Bucket: BUCKET,
			Key: s3Key,
			ResponseContentDisposition: "inline",
			ResponseContentType: safeContentType,
		});
		return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
	}

	return `/uploads/${s3Key}`;
};

/**
 * Mint a presigned PUT URL so the client can upload a large file (video)
 * directly to S3, bypassing the app server. Requires real S3 credentials —
 * there is no local-disk fallback, since a browser cannot PUT to this process.
 *
 * IMPORTANT: Only ContentType is included in the presigned signature.
 * Headers like ContentLength, ContentDisposition, and ServerSideEncryption
 * must NOT be signed here because browsers cannot set Content-Length
 * (forbidden header) and won't send the AWS-specific headers automatically.
 * A signed-but-not-sent header causes S3 to reject with a signature mismatch,
 * which the browser surface as "failed to fetch".
 */
export const generatePresignedPutUrl = async (
	key: string,
	contentType: string,
	_contentLength: number,
	expiresInSeconds = 3600,
): Promise<string> => {
	if (!s3PresignClient) {
		throw new Error(
			"Direct-to-S3 upload requires AWS credentials to be configured",
		);
	}
	// Only ContentType is signed — it is the one header the browser fetch() PUT
	// will reliably send. ContentLength is a forbidden header in browsers;
	// ContentDisposition and ServerSideEncryption must be applied via bucket
	// policy or a server-side copy, not via the browser presigned URL.
	const command = new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		ContentType: contentType,
	});
	return getSignedUrl(s3PresignClient, command, { expiresIn: expiresInSeconds });
};

/**
 * HEAD an S3 object to confirm it exists and read back its declared
 * Content-Type/Content-Length. Used to verify a client actually completed a
 * presigned-PUT upload before trusting the S3 key it reports.
 */
export const headS3Object = async (
	key: string,
): Promise<{ contentType: string | null; contentLength: number | null } | null> => {
	if (!s3Client) {
		const targetPath = path.join(UPLOADS_DIR, key);
		try {
			const stat = await readFile(targetPath);
			return { contentType: null, contentLength: stat.byteLength };
		} catch {
			return null;
		}
	}
	try {
		const head = await s3Client.send(
			new HeadObjectCommand({ Bucket: BUCKET, Key: key }),
		);
		return {
			contentType: head.ContentType ?? null,
			contentLength: head.ContentLength ?? null,
		};
	} catch (err: any) {
		if (err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404) {
			return null;
		}
		throw err;
	}
};

/**
 * Fetch an object's full body into memory. Only used server-side for
 * one-off work (e.g. the media-dimensions backfill script measuring an
 * already-uploaded image) — request-path code should keep using
 * generateSignedUrl and let the client fetch directly, not round-trip
 * through this process.
 */
export const getObjectBuffer = async (key: string): Promise<Buffer> => {
	if (!s3Client) {
		const targetPath = path.join(UPLOADS_DIR, key);
		return readFile(targetPath);
	}
	const result = await s3Client.send(
		new GetObjectCommand({ Bucket: BUCKET, Key: key }),
	);
	const body = result.Body;
	if (!body) {
		throw new Error(`S3 object has no body: ${key}`);
	}
	const chunks: Buffer[] = [];
	// @ts-expect-error — Node runtime returns a Readable; the SDK's browser
	// (ReadableStream/Blob) types don't apply here.
	for await (const chunk of body) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
};
