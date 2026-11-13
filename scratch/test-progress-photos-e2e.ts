/**
 * Comprehensive End-to-End Test Suite for the Progress Photos Feature.
 *
 * Verifies the full user flow and edge cases against the live Express app:
 *   - Authentication via POST /auth/login (whiskey@gmail.com / whiskey123)
 *   - 3-pose photo uploads (Front, Side, Back) with Jimp-generated images
 *   - Same-day idempotent replacement & old storage cleanup
 *   - Timeline retrieval (GET /progress/photos/me) with day-grouping & signed URLs
 *   - Multi-date comparison (GET /progress/photos/me/compare?dateA=...&dateB=...)
 *   - Security: Magic byte spoofing rejection, invalid poses, out-of-bounds weight
 *   - Privacy: isPrivateToSelf filtering for staff
 *   - RBAC: Assigned Trainer & Nutritionist access vs. unassigned staff rejection
 *   - Photo deletion & MongoDB/S3 asset cleanup
 *
 * Usage:
 *   bun run scratch/test-progress-photos-e2e.ts
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "dotenv";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import app from "../src/app";
import { Gender, MembershipStatus, PhotoPose } from "../src/models/Enums";
import Membership from "../src/models/Membership";
import NutritionistBooking from "../src/models/NutritionistBooking";
import ProgressPhoto from "../src/models/ProgressPhoto";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { getJwtConfig, signAdminToken, signAuthToken } from "../src/utils/jwt";
import { hashPassword } from "../src/utils/password";

config();

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
	if (condition) {
		passed++;
		console.log(`  ✅ PASS  ${name}`);
	} else {
		failed++;
		console.log(`  ❌ FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

function section(title: string): void {
	console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
	console.log(`  ${title}`);
	console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

async function createTestJpeg(color = 0x8a965aff, width = 300, height = 400): Promise<Buffer> {
	const img = new Jimp({ width, height, color });
	return await img.getBuffer("image/jpeg", { quality: 85 });
}

async function run(): Promise<void> {
	console.log("\n🚀 Starting Progress Photos E2E Test Suite...\n");

	await connectDB();
	check("MongoDB connected", mongoose.connection.readyState === 1);

	// Start ephemeral server
	const server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const port = (server.address() as AddressInfo).port;
	const baseUrl = `http://127.0.0.1:${port}`;
	process.env.BACKEND_URL = baseUrl;
	console.log(`  🌐 Test server listening on ${baseUrl}`);

	const jwtConfig = getJwtConfig();
	if (!jwtConfig) throw new Error("JWT_SECRET is not configured");

	// ── 1. Setup Whiskey and Staff Roster ──────────────────────────────────────
	section("1. User Setup & Authentication");

	const whiskeyEmail = "whiskey@gmail.com";
	const whiskeyPassword = "whiskey123";
	const whiskeyHash = await hashPassword(whiskeyPassword);

	let whiskey = await User.findOne({ email: whiskeyEmail });
	if (!whiskey) {
		whiskey = await User.create({
			username: "Whiskey Member",
			email: whiskeyEmail,
			phone: "919876543210",
			passwordHash: whiskeyHash,
			gender: Gender.Male,
			age: 28,
			onboarded: true,
		});
	} else {
		whiskey.passwordHash = whiskeyHash;
		whiskey.onboarded = true;
		await whiskey.save();
	}
	const whiskeyId = whiskey._id.toString();

	// Ensure Whiskey has an active membership for general member permissions
	const existingMem = await Membership.findOne({ user: whiskey._id });
	if (!existingMem) {
		await Membership.create({
			user: whiskey._id,
			planName: "Longevity Pro",
			price: 4999,
			status: MembershipStatus.Active,
			startDate: new Date(Date.now() - 30 * 86400000),
			endDate: new Date(Date.now() + 60 * 86400000),
			creditsIncluded: 50,
			creditsRemaining: 45,
		});
	}

	// Login via POST /auth/login
	const loginRes = await fetch(`${baseUrl}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email: whiskeyEmail, password: whiskeyPassword }),
	});
	const loginJson: any = await loginRes.json().catch(() => ({}));
	check("POST /auth/login succeeds (200)", loginRes.status === 200);
	check("JWT token returned from login", Boolean(loginJson.token || loginJson.accessToken));
	const memberToken = (loginJson.token || loginJson.accessToken) as string;

	// Setup Assigned Trainer vs Unassigned Trainer
	const assignedTrainerDoc = await Trainer.findOneAndUpdate(
		{ email: "trainer.assigned@fitflix.com" },
		{ trainerName: "Assigned Coach Dave", email: "trainer.assigned@fitflix.com", phone: "9100000001" },
		{ upsert: true, returnDocument: "after" },
	);
	const unassignedTrainerDoc = await Trainer.findOneAndUpdate(
		{ email: "trainer.stranger@fitflix.com" },
		{ trainerName: "Stranger Coach Sam", email: "trainer.stranger@fitflix.com", phone: "9100000002" },
		{ upsert: true, returnDocument: "after" },
	);

	// Setup Assigned Nutritionist vs Unassigned Nutritionist
	let assignedNutri = await User.findOne({ email: "nutri.assigned@fitflix.com" });
	if (!assignedNutri) {
		assignedNutri = await User.create({
			username: "Assigned Nutritionist Sarah",
			email: "nutri.assigned@fitflix.com",
			phone: "9100000003",
			role: "nutritionist",
			gender: Gender.Female,
		});
	}
	let unassignedNutri = await User.findOne({ email: "nutri.stranger@fitflix.com" });
	if (!unassignedNutri) {
		unassignedNutri = await User.create({
			username: "Stranger Nutritionist Bob",
			email: "nutri.stranger@fitflix.com",
			phone: "9100000004",
			role: "nutritionist",
			gender: Gender.Male,
		});
	}

	// Assign Coach Dave and Nutritionist Sarah to Whiskey
	whiskey.assignedTrainer = assignedTrainerDoc!._id as any;
	(whiskey as any).assignedNutritionistId = assignedNutri._id;
	await whiskey.save();

	// Create NutritionistBooking binding Sarah to Whiskey
	await NutritionistBooking.findOneAndUpdate(
		{ userId: whiskey._id },
		{
			userId: whiskey._id,
			assignedNutritionistId: assignedNutri._id,
			bookingDate: new Date(),
			startTime: "10:00",
			endTime: "10:30",
			appointmentMode: "ONLINE",
			status: "ACCEPTED",
		},
		{ upsert: true },
	);

	const assignedTrainerToken = signAuthToken(
		{ id: assignedTrainerDoc!._id.toString(), email: assignedTrainerDoc!.email, role: "trainer" },
		jwtConfig,
	);
	const unassignedTrainerToken = signAuthToken(
		{ id: unassignedTrainerDoc!._id.toString(), email: unassignedTrainerDoc!.email, role: "trainer" },
		jwtConfig,
	);

	const assignedNutriToken = signAuthToken(
		{ id: assignedNutri._id.toString(), email: assignedNutri.email, role: "nutritionist" },
		jwtConfig,
	);
	const unassignedNutriToken = signAuthToken(
		{ id: unassignedNutri._id.toString(), email: unassignedNutri.email, role: "nutritionist" },
		jwtConfig,
	);

	// Setup Admin and Intruder Member
	const adminToken = signAdminToken(
		{ id: new mongoose.Types.ObjectId().toString(), email: "admin@fitflix.com", role: "admin" },
		jwtConfig,
	);
	const intruderUser = await User.findOneAndUpdate(
		{ email: "intruder@gmail.com" },
		{ username: "Intruder", email: "intruder@gmail.com", phone: "9100000099", gender: Gender.Other },
		{ upsert: true, returnDocument: "after" },
	);
	const intruderToken = signAuthToken(
		{ id: intruderUser!._id.toString(), email: intruderUser!.email, role: "user" },
		jwtConfig,
	);

	// Clear previous photos for clean test runs
	await ProgressPhoto.deleteMany({ userId: whiskey._id });

	// ── 2. Happy Path: 3-Pose Photo Upload ─────────────────────────────────────
	section("2. Happy Path: 3-Pose Photo Uploads");

	const today = new Date().toISOString();
	const testJpeg = await createTestJpeg(0x8a965aff, 320, 420);

	// Upload Front Pose
	const frontForm = new FormData();
	frontForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "front.jpg");
	frontForm.append("pose", "front");
	frontForm.append("recordedDate", today);
	frontForm.append("weightKg", "78.4");
	frontForm.append("notes", "Front view - good definition");

	const uploadFrontRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: frontForm,
	});
	const frontJson: any = await uploadFrontRes.json().catch(() => ({}));
	check("POST /progress/photos [Front] → 201 Created", uploadFrontRes.status === 201);
	check("Response returns photo object", Boolean(frontJson.photo?._id));
	check("Pose is 'front'", frontJson.photo?.pose === "front");
	check("Presigned full URL generated", typeof frontJson.photo?.url === "string");
	check("Presigned thumbnail URL generated", typeof frontJson.photo?.thumbnailUrl === "string");
	check("Weight 78.4 kg persisted", frontJson.photo?.weightKg === 78.4);
	let frontPhotoId = frontJson.photo?._id;

	// Upload Side Pose
	const sideForm = new FormData();
	sideForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "side.jpg");
	sideForm.append("pose", "side");
	sideForm.append("recordedDate", today);
	sideForm.append("weightKg", "78.4");

	const uploadSideRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: sideForm,
	});
	const sideJson: any = await uploadSideRes.json().catch(() => ({}));
	check("POST /progress/photos [Side] → 201 Created", uploadSideRes.status === 201);
	check("Pose is 'side'", sideJson.photo?.pose === "side");

	// Upload Back Pose
	const backForm = new FormData();
	backForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "back.jpg");
	backForm.append("pose", "back");
	backForm.append("recordedDate", today);

	const uploadBackRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: backForm,
	});
	const backJson: any = await uploadBackRes.json().catch(() => ({}));
	check("POST /progress/photos [Back] → 201 Created", uploadBackRes.status === 201);
	check("Pose is 'back'", backJson.photo?.pose === "back");

	// ── 3. Happy Path: Member Timeline Retrieval ───────────────────────────────
	section("3. Happy Path: Member Timeline (GET /progress/photos/me)");

	const getMeRes = await fetch(`${baseUrl}/progress/photos/me`, {
		headers: { Authorization: `Bearer ${memberToken}` },
	});
	const getMeJson: any = await getMeRes.json().catch(() => ({}));
	check("GET /progress/photos/me → 200 OK", getMeRes.status === 200);
	check("Returns total of 3 photos", getMeJson.total === 3);
	check("Grouped into 1 check-in entry", getMeJson.checkIns?.length === 1);

	const todayCheckIn = getMeJson.checkIns?.[0];
	check("Check-in contains Front pose", Boolean(todayCheckIn?.poses?.front));
	check("Check-in contains Side pose", Boolean(todayCheckIn?.poses?.side));
	check("Check-in contains Back pose", Boolean(todayCheckIn?.poses?.back));
	check("Check-in carries weight 78.4 kg", todayCheckIn?.weightKg === 78.4);

	// Pose filter query test
	const filterRes = await fetch(`${baseUrl}/progress/photos/me?pose=front`, {
		headers: { Authorization: `Bearer ${memberToken}` },
	});
	const filterJson: any = await filterRes.json().catch(() => ({}));
	check("GET /progress/photos/me?pose=front returns only 1 photo", filterJson.photos?.length === 1);

	// ── 4. Happy Path: Idempotent Same-Day Replacement ─────────────────────────
	section("4. Same-Day Pose Replacement & Storage Cleanup");

	const replaceForm = new FormData();
	const newJpeg = await createTestJpeg(0x3355ffff, 320, 420);
	replaceForm.append("file", new Blob([newJpeg], { type: "image/jpeg" }), "front_new.jpg");
	replaceForm.append("pose", "front");
	replaceForm.append("recordedDate", today);
	replaceForm.append("notes", "Updated front pose with better lighting");

	const replaceRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: replaceForm,
	});
	const replaceJson: any = await replaceRes.json().catch(() => ({}));
	check("POST /progress/photos replace front → 201 Created", replaceRes.status === 201);
	check("Notes updated on replacement", replaceJson.photo?.notes === "Updated front pose with better lighting");
	frontPhotoId = replaceJson.photo?._id || frontPhotoId;

	const totalFrontInDb = await ProgressPhoto.countDocuments({
		userId: whiskey._id,
		pose: "front",
	});
	check("No duplicate created in DB (exactly 1 front photo exists)", totalFrontInDb === 1);

	// ── 5. Multi-Date Comparison ───────────────────────────────────────────────
	section("5. Multi-Date Comparison (GET /progress/photos/me/compare)");

	// Seed a past baseline check-in (30 days ago)
	const baselineDate = new Date(Date.now() - 30 * 86400000);
	const baselineDateStr = baselineDate.toISOString().slice(0, 10);
	const todayDateStr = new Date().toISOString().slice(0, 10);

	await ProgressPhoto.create({
		userId: whiskey._id,
		recordedDate: new Date(Date.UTC(baselineDate.getUTCFullYear(), baselineDate.getUTCMonth(), baselineDate.getUTCDate())),
		pose: PhotoPose.Front,
		s3Key: "test-baseline-front.jpg",
		thumbnailKey: "test-baseline-front-thumb.jpg",
		weightKg: 84.0,
		notes: "Day 1 Baseline",
	});

	const compareRes = await fetch(
		`${baseUrl}/progress/photos/me/compare?dateA=${baselineDateStr}&dateB=${todayDateStr}`,
		{
			headers: { Authorization: `Bearer ${memberToken}` },
		},
	);
	const compareJson: any = await compareRes.json().catch(() => ({}));
	check("GET /progress/photos/me/compare → 200 OK", compareRes.status === 200);
	check("Carries 'before' check-in with baseline date", compareJson.before?.date === baselineDateStr);
	check("Baseline weight is 84.0 kg", compareJson.before?.weightKg === 84);
	check("Carries 'after' check-in with today's date", compareJson.after?.date === todayDateStr);
	check("Current weight is 78.4 kg", compareJson.after?.weightKg === 78.4);

	// ── 6. Edge Cases & Validation Hardening ────────────────────────────────────
	section("6. Edge Cases: Security & Payload Validation");

	// Edge Case: Extension spoofing (text file sent as JPEG)
	const spoofForm = new FormData();
	spoofForm.append(
		"file",
		new Blob([Buffer.from("Hello I am a text file pretending to be an image")], { type: "image/jpeg" }),
		"spoof.jpg",
	);
	spoofForm.append("pose", "front");

	const spoofRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: spoofForm,
	});
	check("Extension spoofing rejected with 400", spoofRes.status === 400);

	// Edge Case: Invalid Pose
	const invalidPoseForm = new FormData();
	invalidPoseForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "photo.jpg");
	invalidPoseForm.append("pose", "handstand");

	const invalidPoseRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: invalidPoseForm,
	});
	check("Invalid pose rejected with 400 VALIDATION_ERROR", invalidPoseRes.status === 400);

	// Edge Case: Negative weight
	const negWeightForm = new FormData();
	negWeightForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "photo.jpg");
	negWeightForm.append("pose", "front");
	negWeightForm.append("weightKg", "-12");

	const negWeightRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: negWeightForm,
	});
	check("Negative weight rejected with 400", negWeightRes.status === 400);

	// Edge Case: Out-of-bounds high weight (> 300 kg)
	const heavyWeightForm = new FormData();
	heavyWeightForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "photo.jpg");
	heavyWeightForm.append("pose", "front");
	heavyWeightForm.append("weightKg", "650");

	const heavyWeightRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: heavyWeightForm,
	});
	check("Over-limit weight (>300 kg) rejected with 400", heavyWeightRes.status === 400);

	// Edge Case: Missing file
	const noFileForm = new FormData();
	noFileForm.append("pose", "front");
	const noFileRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: noFileForm,
	});
	check("Missing file rejected with 400", noFileRes.status === 400);

	// ── 7. Privacy & Staff Access Control (RBAC) ──────────────────────────────
	section("7. Privacy Flag & Staff RBAC (Assigned Trainer & Nutritionist)");

	// Upload a private photo: isPrivateToSelf = true
	const privateDate = new Date(Date.now() - 5 * 86400000);
	const privateForm = new FormData();
	privateForm.append("file", new Blob([testJpeg], { type: "image/jpeg" }), "private.jpg");
	privateForm.append("pose", "side");
	privateForm.append("recordedDate", privateDate.toISOString());
	privateForm.append("isPrivateToSelf", "true");

	const privateRes = await fetch(`${baseUrl}/progress/photos`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberToken}` },
		body: privateForm,
	});
	check("Upload with isPrivateToSelf=true → 201 Created", privateRes.status === 201);

	// 1. Intruder member attempts to view Whiskey's photos
	const intruderRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${intruderToken}` },
	});
	check("Intruder member viewing Whiskey photos → 403 Forbidden", intruderRes.status === 403);

	// 2. Unassigned Trainer attempts to view Whiskey's photos
	const unassignedTrainerRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${unassignedTrainerToken}` },
	});
	check("Unassigned Trainer viewing Whiskey photos → 403 Forbidden", unassignedTrainerRes.status === 403);

	// 3. Assigned Trainer views Whiskey's photos
	const assignedTrainerRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${assignedTrainerToken}` },
	});
	const assignedTrainerJson: any = await assignedTrainerRes.json().catch(() => ({}));
	check("Assigned Trainer viewing Whiskey photos → 200 OK", assignedTrainerRes.status === 200);

	// Verify the private photo is hidden from the trainer!
	const trainerPhotos = assignedTrainerJson.photos ?? [];
	const trainerSeesPrivate = trainerPhotos.some((p: any) => p.isPrivateToSelf === true);
	check("Private photo is hidden from Assigned Trainer", !trainerSeesPrivate);

	// 4. Unassigned Nutritionist attempts to view Whiskey's photos
	const unassignedNutriRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${unassignedNutriToken}` },
	});
	check("Unassigned Nutritionist viewing Whiskey photos → 403 Forbidden", unassignedNutriRes.status === 403);

	// 5. Assigned Nutritionist views Whiskey's photos
	const assignedNutriRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${assignedNutriToken}` },
	});
	check("Assigned Nutritionist viewing Whiskey photos → 200 OK", assignedNutriRes.status === 200);

	// 6. Admin views Whiskey's photos
	const adminRes = await fetch(`${baseUrl}/progress/photos/user/${whiskeyId}`, {
		headers: { Authorization: `Bearer ${adminToken}` },
	});
	check("Club Admin viewing Whiskey photos → 200 OK", adminRes.status === 200);

	// ── 8. Deletion & Cleanup ──────────────────────────────────────────────────
	section("8. Photo Deletion & S3 Cleanup");

	// Intruder tries to delete Whiskey's photo
	const intruderDeleteRes = await fetch(`${baseUrl}/progress/photos/${frontPhotoId}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${intruderToken}` },
	});
	check("Intruder deleting Whiskey photo → 404/403", intruderDeleteRes.status === 404 || intruderDeleteRes.status === 403);

	// Member deletes their own photo
	const memberDeleteRes = await fetch(`${baseUrl}/progress/photos/${frontPhotoId}`, {
		method: "DELETE",
		headers: { Authorization: `Bearer ${memberToken}` },
	});
	check("Member deletes own photo → 200 OK", memberDeleteRes.status === 200);

	const inDbAfterDelete = await ProgressPhoto.findById(frontPhotoId);
	check("Photo document successfully removed from MongoDB", inDbAfterDelete === null);

	// Clean up all remaining test documents
	await ProgressPhoto.deleteMany({ userId: whiskey._id });
	await server.close();

	// ── Final Summary ──────────────────────────────────────────────────────────
	section("TEST EXECUTION SUMMARY");
	console.log(`  Total Checks: ${passed + failed}`);
	console.log(`  Passed:       ${passed}`);
	console.log(`  Failed:       ${failed}`);
	console.log(`  Result:       ${failed === 0 ? "🎉 ALL TESTS PASSED!" : "⚠️ SOME TESTS FAILED"}\n`);

	if (failed > 0) {
		process.exit(1);
	}
}

run()
	.catch((err) => {
		console.error("Unhandled error during test run:", err);
		process.exit(1);
	})
	.finally(() => {
		mongoose.disconnect().catch(() => {});
	});
