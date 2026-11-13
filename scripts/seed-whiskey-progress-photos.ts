import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import ProgressPhoto, { PhotoPose } from "../src/models/ProgressPhoto";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { generateSignedUrl, uploadToS3 } from "../src/utils/s3.service";

config();

const TARGET_EMAIL = "whiskey@gmail.com";

if (!process.env.BACKEND_URL) {
	process.env.BACKEND_URL = "https://api.fitflix.in";
}

// 9 High-Quality Curated Real Fitness Transformation Photos (Portrait 3:4)
const checkInDates = [
	{
		label: "Baseline (4 Weeks Ago)",
		date: new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
		weightKg: 82.5,
		notes: "Starting transformation journey. Baseline check-in.",
		poses: [
			{
				pose: PhotoPose.Front,
				sourceUrl: "https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Side,
				sourceUrl: "https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Back,
				sourceUrl: "https://images.unsplash.com/photo-1605296867304-46d5465a13f1?w=1200&h=1600&fit=crop&crop=center&q=85",
			},
		],
	},
	{
		label: "Midway (2 Weeks Ago)",
		date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
		weightKg: 80.2,
		notes: "Midway check-in: down 2.3 kg. Core tightening, energy levels high.",
		poses: [
			{
				pose: PhotoPose.Front,
				sourceUrl: "https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Side,
				sourceUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Back,
				sourceUrl: "https://images.unsplash.com/photo-1581009137042-c552e485697a?w=1200&h=1600&fit=crop&crop=center&q=85",
			},
		],
	},
	{
		label: "Current (Today)",
		date: new Date(),
		weightKg: 78.4,
		notes: "4 weeks in! Total 4.1 kg down. Muscle definition showing in back and delts.",
		poses: [
			{
				pose: PhotoPose.Front,
				sourceUrl: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Side,
				sourceUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&h=1600&fit=crop&crop=faces,center&q=85",
			},
			{
				pose: PhotoPose.Back,
				sourceUrl: "https://images.unsplash.com/photo-1526506118085-60ce8714f8c5?w=1200&h=1600&fit=crop&crop=center&q=85",
			},
		],
	},
];

async function downloadAndPrepareVariants(sourceUrl: string): Promise<{ fullBuf: Buffer; thumbBuf: Buffer }> {
	const res = await fetch(sourceUrl);
	if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
	const rawBuf = Buffer.from(await res.arrayBuffer());

	const img = await Jimp.read(rawBuf);

	// Full size variant: max 1200w x 1600h
	const fullImg = img.clone();
	if (fullImg.width > 1200) {
		fullImg.resize({ w: 1200 });
	}
	const fullBuf = await fullImg.getBuffer("image/jpeg", { quality: 85 });

	// Thumbnail variant: 400w
	const thumbImg = img.clone();
	thumbImg.resize({ w: 400 });
	const thumbBuf = await thumbImg.getBuffer("image/jpeg", { quality: 75 });

	return { fullBuf, thumbBuf };
}

async function run(): Promise<void> {
	console.log("\n📸 Seeding REAL High-Resolution Progress Photos for Whiskey Member...\n");

	await connectDB();
	console.log("  ✅ Connected to MongoDB");

	const whiskey = await User.findOne({ email: TARGET_EMAIL });
	if (!whiskey) {
		console.error(`  ❌ User ${TARGET_EMAIL} not found in database.`);
		process.exit(1);
	}
	console.log(`  👤 Found user: ${whiskey.username} (${whiskey._id})`);

	const isClean = process.argv.includes("--clean");
	if (isClean) {
		const deleted = await ProgressPhoto.deleteMany({ userId: whiskey._id });
		console.log(`  🧹 Cleaned up ${deleted.deletedCount} progress photos for ${TARGET_EMAIL}.`);
		process.exit(0);
	}

	// Clean out previous mock photos
	await ProgressPhoto.deleteMany({ userId: whiskey._id });
	console.log("  🧹 Cleared old solid color mock photos from MongoDB");

	console.log(`\n  ☁️ S3 Bucket: ${process.env.AWS_S3_BUCKET || "fitflix-storage"}`);
	console.log(`  🌏 AWS Region: ${process.env.AWS_REGION || "ap-south-1"}`);
	console.log(
		`  🔑 AWS Key:    ${process.env.AWS_ACCESS_KEY_ID ? `${process.env.AWS_ACCESS_KEY_ID.slice(0, 8)}...` : "NONE"}\n`,
	);

	for (const checkIn of checkInDates) {
		const normalizedDate = new Date(
			Date.UTC(
				checkIn.date.getUTCFullYear(),
				checkIn.date.getUTCMonth(),
				checkIn.date.getUTCDate(),
				0,
				0,
				0,
				0,
			),
		);
		const dateStr = normalizedDate.toISOString().slice(0, 10);
		console.log(`  📅 ${checkIn.label} (${dateStr}) - Weight: ${checkIn.weightKg} kg`);

		for (const poseInfo of checkIn.poses) {
			const uuid = randomUUID();
			const baseKey = `progress-photos/${whiskey._id}/${dateStr}_${poseInfo.pose}_${uuid}`;
			const fullKey = `${baseKey}_full.jpg`;
			const thumbKey = `${baseKey}_thumb.jpg`;

			process.stdout.write(`     • Downloading & processing ${poseInfo.pose.toUpperCase()} photo... `);
			const { fullBuf, thumbBuf } = await downloadAndPrepareVariants(poseInfo.sourceUrl);

			// Upload both variants directly to AWS S3
			await Promise.all([
				uploadToS3(fullKey, fullBuf, "image/jpeg"),
				uploadToS3(thumbKey, thumbBuf, "image/jpeg"),
			]);

			// Save record to MongoDB
			await ProgressPhoto.create({
				userId: whiskey._id,
				pose: poseInfo.pose,
				recordedDate: normalizedDate,
				s3Key: fullKey,
				thumbnailKey: thumbKey,
				weightKg: checkIn.weightKg,
				notes: checkIn.notes,
				isPrivateToSelf: false,
			});

			const presignedUrl = await generateSignedUrl(thumbKey, 900, "image/jpeg");
			console.log(`Uploaded to AWS S3!`);
			console.log(`       S3 Key: ${fullKey}`);
			console.log(`       Presigned URL: ${presignedUrl.slice(0, 75)}...`);
		}
	}

	const total = await ProgressPhoto.countDocuments({ userId: whiskey._id });
	console.log(`\n🎉 Successfully seeded ${total} REAL progress photos across 3 check-in dates for ${TARGET_EMAIL}!`);
	console.log("   Check the Fitflix App right now to see the real fitness transformation photos!\n");

	process.exit(0);
}

run().catch((err) => {
	console.error("Seed script failed:", err);
	process.exit(1);
});
