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

const REGION = process.env.AWS_REGION ?? "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET ?? "fitflix-storage";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID?.trim() ?? "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? "";

const hasAwsCredentials = Boolean(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY);

const s3Client = hasAwsCredentials
	? new S3Client({
			region: REGION,
			credentials: {
				accessKeyId: AWS_ACCESS_KEY_ID,
				secretAccessKey: AWS_SECRET_ACCESS_KEY,
			},
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
 */
export const generatePresignedPutUrl = async (
	key: string,
	contentType: string,
	contentLength: number,
	expiresInSeconds = 3600,
): Promise<string> => {
	if (!s3Client) {
		throw new Error(
			"Direct-to-S3 upload requires AWS credentials to be configured",
		);
	}
	const command = new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		ContentType: contentType,
		ContentLength: contentLength,
		ContentDisposition: "inline",
		ServerSideEncryption: "AES256",
	});
	return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
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
