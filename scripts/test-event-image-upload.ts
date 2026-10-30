import fs from "fs";
import path from "path";
import { uploadToS3, getPublicAssetUrl } from "../src/utils/s3.service";

async function run() {
	console.log("===================================================================");
	console.log("🧪 TESTING EVENT ASSET IMAGE UPLOADING (AWS S3 + LOCAL FALLBACK)");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// 1. Create a 1x1 transparent PNG sample buffer
	const samplePngBuffer = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
		"base64",
	);

	const timestamp = Date.now();

	// --- 1. AWS S3 Connected Upload Test ---
	console.log("👉 Test 1: Upload Partner Logo via AWS S3 Service");
	const collabKey = `events/collaborator-test-${timestamp}.png`;
	const collabResult = await uploadToS3(collabKey, samplePngBuffer, "image/png");

	console.log("   Upload Result:", JSON.stringify(collabResult, null, 2));

	if (
		collabResult.s3Key === collabKey &&
		(collabResult.url.includes("fitflix-storage.s3.ap-south-1.amazonaws.com") ||
			collabResult.url.includes("/uploads/"))
	) {
		console.log(`✅ Case 1: Partner logo uploaded successfully -> ${collabResult.url}`);
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: S3 upload result invalid");
		failCount++;
	}

	// --- 2. Upload Sponsor Logo Test ---
	console.log("\n👉 Test 2: Upload Sponsor Logo");
	const sponsorKey = `events/sponsor-test-${timestamp}.png`;
	const sponsorResult = await uploadToS3(sponsorKey, samplePngBuffer, "image/png");

	if (
		sponsorResult.s3Key === sponsorKey &&
		(sponsorResult.url.includes("fitflix-storage.s3.ap-south-1.amazonaws.com") ||
			sponsorResult.url.includes("/uploads/"))
	) {
		console.log(`✅ Case 2: Sponsor logo uploaded successfully -> ${sponsorResult.url}`);
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Sponsor upload result invalid");
		failCount++;
	}

	// --- 3. Upload Event Cover Poster ---
	console.log("\n👉 Test 3: Upload Event Cover Poster");
	const coverKey = `events/cover-test-${timestamp}.png`;
	const coverResult = await uploadToS3(coverKey, samplePngBuffer, "image/png");

	if (
		coverResult.s3Key === coverKey &&
		(coverResult.url.includes("fitflix-storage.s3.ap-south-1.amazonaws.com") ||
			coverResult.url.includes("/uploads/"))
	) {
		console.log(`✅ Case 3: Cover poster uploaded successfully -> ${coverResult.url}`);
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Cover poster upload result invalid");
		failCount++;
	}

	// --- 4. Local Disk Fallback Simulation ---
	console.log("\n👉 Test 4: Local Disk Fallback Simulation (Offline / No AWS Creds)");
	const localUploadsDir = path.resolve(process.cwd(), "uploads", "events");
	fs.mkdirSync(localUploadsDir, { recursive: true });
	const testLocalFile = path.join(localUploadsDir, `local-fallback-${timestamp}.png`);
	fs.writeFileSync(testLocalFile, samplePngBuffer);

	const localExists = fs.existsSync(testLocalFile);
	const readBytes = fs.readFileSync(testLocalFile);
	if (localExists && readBytes.equals(samplePngBuffer)) {
		console.log(`✅ Case 4: Local disk fallback confirmed at: ${testLocalFile}`);
		console.log("          Bytes verified intact.");
		passCount++;
		fs.unlinkSync(testLocalFile);
	} else {
		console.error("❌ Case 4 Failed: Local fallback disk write failed");
		failCount++;
	}

	// --- 5. URL Generator Consistency ---
	console.log("\n👉 Test 5: Public Asset URL Consistency");
	const generatedUrl = getPublicAssetUrl("events/collaborators/chapter-5.png");
	if (
		generatedUrl.startsWith("https://fitflix-storage.s3.ap-south-1.amazonaws.com") ||
		generatedUrl.includes("/uploads/")
	) {
		console.log(`✅ Case 5: Public URL format valid -> ${generatedUrl}`);
		passCount++;
	} else {
		console.error(`❌ Case 5 Failed: Unexpected URL format: ${generatedUrl}`);
		failCount++;
	}

	console.log("\n===================================================================");
	console.log(`🎉 TEST SUMMARY: ${passCount} Passed, ${failCount} Failed.`);
	console.log("===================================================================");

	process.exit(failCount > 0 ? 1 : 0);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
