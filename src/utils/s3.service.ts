import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
): Promise<{ fileUrl: string; s3Key: string }> => {
	await s3Client.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			Body: buffer,
			ContentType: contentType,
		}),
	);
	return {
		s3Key: key,
		fileUrl: `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`,
	};
};

export const generateSignedUrl = async (
	s3Key: string,
	expiresInSeconds = 3600,
): Promise<string> => {
	const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
	return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};
