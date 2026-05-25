import {
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream } from "fs";

const REGION = process.env.AWS_REGION ?? "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET ?? "fitflix-storage";

const s3Client = new S3Client({
	region: REGION,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
	},
});

export const uploadToS3 = async (
	key: string,
	buffer: Buffer,
	contentType: string,
): Promise<{ s3Key: string }> => {
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

	return {
		s3Key: key,
	};
};

export const deleteFromS3 = async (key: string): Promise<void> => {
	await s3Client.send(
		new DeleteObjectCommand({
			Bucket: BUCKET,
			Key: key,
		}),
	);
};

const SAFE_MIME_TYPES = [
	"application/pdf",
	"image/jpeg",
	"image/png",
];

export const generateSignedUrl = async (
	s3Key: string,
	expiresInSeconds = 900,
	contentType?: string | null,
): Promise<string> => {
	// Strictly validate content type to prevent ResponseContentType injection attacks (stored XSS)
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
};
