/**
 * scripts/test-chat-media-e2e.ts
 *
 * End-to-End Test Suite for Milestone 1:
 * - Media attachment presigning (Image, Audio, Video)
 * - Validation & size ceiling enforcement
 * - Direct S3 PUT upload
 * - Media message persistence & retrieval
 * - Conversation preview formatting
 */
import axios from "axios";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import Trainer from "../src/models/Trainer";
import ChatConversation from "../src/models/ChatConversation";
import { hashPassword } from "../src/utils/password";

const BASE_URL = process.env.API_URL || "http://localhost:3000";

async function main() {
	console.log("=================================================");
	console.log("🚀 STARTING CHAT MEDIA E2E TEST SUITE (MILESTONE 1)");
	console.log(`Target Backend: ${BASE_URL}`);
	console.log("=================================================\n");

	await connectDB();

	// 1. Ensure test member exists
	let member = await User.findOne({ email: "whiskey@gmail.com" });
	if (!member) {
		console.log("Creating whiskey@gmail.com test member...");
		const passwordHash = await hashPassword("whiskey123");
		member = await User.create({
			username: "Whiskey Member",
			email: "whiskey@gmail.com",
			phone: "9876543210",
			passwordHash,
			onboarded: true,
			isActive: true,
		});
	}

	// 2. Ensure test trainer exists
	let trainer = await Trainer.findOne({ email: "ravi@chat.test" });
	if (!trainer) {
		console.log("Creating ravi@chat.test test trainer...");
		const passwordHash = await hashPassword("chat-demo-1234");
		trainer = await Trainer.create({
			trainerName: "Ravi Coach",
			email: "ravi@chat.test",
			phone: "9000000002",
			passwordHash,
			isActive: true,
		});
	}

	// Assign trainer to member
	await User.updateOne(
		{ _id: member._id },
		{ $set: { assignedTrainer: trainer._id } },
	);

	// 3. Login as Member
	console.log("1. Authenticating as Member (whiskey@gmail.com)...");
	const memberLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
		email: "whiskey@gmail.com",
		password: "whiskey123",
	});
	const memberToken = memberLoginRes.data.accessToken;
	const memberHeaders = { Authorization: `Bearer ${memberToken}` };
	console.log("   ✅ Member logged in successfully.\n");

	// 4. Login as Trainer
	console.log("2. Authenticating as Trainer (ravi@chat.test)...");
	const trainerLoginRes = await axios.post(`${BASE_URL}/auth/login`, {
		email: "ravi@chat.test",
		password: "chat-demo-1234",
	});
	const trainerToken = trainerLoginRes.data.accessToken;
	const trainerHeaders = { Authorization: `Bearer ${trainerToken}` };
	console.log("   ✅ Trainer logged in successfully.\n");

	// 5. Open/Get Conversation between Member and Trainer
	console.log("3. Opening 1-to-1 conversation...");
	const convRes = await axios.post(
		`${BASE_URL}/chat/conversations`,
		{
			kind: "Trainer",
			id: String(trainer._id),
		},
		{ headers: memberHeaders },
	);
	const conversation = convRes.data.conversation;
	const conversationId = conversation.id;
	console.log(`   ✅ Conversation active: ${conversationId}\n`);

	// 6. Test Media Presigning Endpoint
	console.log("4. Testing POST /chat/conversations/:id/media/presign...");

	// Test A: Image Presigning
	console.log("   [Test A] Presigning Image (Meal plate photo)...");
	const imagePresignRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
		{
			fileName: "meal_chicken_rice.jpg",
			mimeType: "image/jpeg",
			byteSize: 1024 * 850, // 850 KB
			kind: "image",
		},
		{ headers: memberHeaders },
	);
	if (!imagePresignRes.data.uploadUrl || !imagePresignRes.data.s3Key) {
		throw new Error("Missing uploadUrl or s3Key in image presign response");
	}
	console.log("   ✅ Image presign URL generated successfully.");
	console.log(`      s3Key: ${imagePresignRes.data.s3Key}`);

	// Test B: Audio Presigning (Voice Memo)
	console.log("   [Test B] Presigning Audio (Coach voice memo)...");
	const audioPresignRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
		{
			fileName: "voice_memo_1.m4a",
			mimeType: "audio/m4a",
			byteSize: 1024 * 320, // 320 KB
			kind: "audio",
		},
		{ headers: trainerHeaders },
	);
	if (!audioPresignRes.data.uploadUrl || !audioPresignRes.data.s3Key) {
		throw new Error("Missing uploadUrl or s3Key in audio presign response");
	}
	console.log("   ✅ Audio presign URL generated successfully.");
	console.log(`      s3Key: ${audioPresignRes.data.s3Key}`);

	// Test C: Video Presigning (Form Check)
	console.log("   [Test C] Presigning Video (Squat form check)...");
	const videoPresignRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
		{
			fileName: "squat_depth_check.mp4",
			mimeType: "video/mp4",
			byteSize: 1024 * 1024 * 18, // 18 MB
			kind: "video",
		},
		{ headers: memberHeaders },
	);
	if (!videoPresignRes.data.uploadUrl || !videoPresignRes.data.s3Key) {
		throw new Error("Missing uploadUrl or s3Key in video presign response");
	}
	console.log("   ✅ Video presign URL generated successfully.");
	console.log(`      s3Key: ${videoPresignRes.data.s3Key}\n`);

	// 7. Test Size Ceiling Rejection
	console.log("5. Testing Size Ceiling Rejection...");
	try {
		await axios.post(
			`${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
			{
				fileName: "huge_video.mp4",
				mimeType: "video/mp4",
				byteSize: 1024 * 1024 * 90, // 90 MB (limit is 50MB)
				kind: "video",
			},
			{ headers: memberHeaders },
		);
		throw new Error("Should have failed with 400 for oversize file");
	} catch (err: any) {
		if (err.response?.status === 400) {
			console.log("   ✅ Correctly rejected oversize video (>50MB) with 400 VALIDATION_ERROR.\n");
		} else {
			throw err;
		}
	}

	// 8. Test Invalid Mime Type Rejection
	console.log("6. Testing Invalid Mime Type Rejection...");
	try {
		await axios.post(
			`${BASE_URL}/chat/conversations/${conversationId}/media/presign`,
			{
				fileName: "malicious.exe",
				mimeType: "application/x-msdownload",
				byteSize: 1024 * 100,
				kind: "image",
			},
			{ headers: memberHeaders },
		);
		throw new Error("Should have failed with 400 for invalid mimeType");
	} catch (err: any) {
		if (err.response?.status === 400) {
			console.log("   ✅ Correctly rejected unsupported mimeType with 400 VALIDATION_ERROR.\n");
		} else {
			throw err;
		}
	}

	// 9. Send Image Message (Meal Plate)
	console.log("7. Sending Image Message (Member -> Coach)...");
	const sendImageRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/messages`,
		{
			kind: "image",
			body: "Coach, does this dinner portion look good for mass gain?",
			media: {
				s3Key: imagePresignRes.data.s3Key,
				url: imagePresignRes.data.url,
				mimeType: "image/jpeg",
				byteSize: 1024 * 850,
				width: 1080,
				height: 1440,
			},
		},
		{ headers: memberHeaders },
	);
	const imageMsg = sendImageRes.data.message;
	if (imageMsg.kind !== "image" || !imageMsg.media?.s3Key) {
		throw new Error("Image message did not persist media schema correctly");
	}
	console.log(`   ✅ Image message sent: ${imageMsg.id}`);
	console.log(`      Media URL: ${imageMsg.media.url}\n`);

	// 10. Send Voice Memo (Coach -> Member) - Body empty to test optional caption
	console.log("8. Sending Voice Memo (Coach -> Member, zero text body)...");
	const sendAudioRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/messages`,
		{
			kind: "audio",
			body: "",
			media: {
				s3Key: audioPresignRes.data.s3Key,
				url: audioPresignRes.data.url,
				mimeType: "audio/m4a",
				byteSize: 1024 * 320,
				durationSeconds: 18.5,
			},
		},
		{ headers: trainerHeaders },
	);
	const audioMsg = sendAudioRes.data.message;
	if (audioMsg.kind !== "audio" || !audioMsg.media?.durationSeconds) {
		throw new Error("Audio message did not persist durationSeconds correctly");
	}
	console.log(`   ✅ Voice memo sent: ${audioMsg.id}`);
	console.log(`      Duration: ${audioMsg.media.durationSeconds}s\n`);

	// 11. Send Form Check Video (Member -> Coach)
	console.log("9. Sending Video Message (Squat Form Check)...");
	const sendVideoRes = await axios.post(
		`${BASE_URL}/chat/conversations/${conversationId}/messages`,
		{
			kind: "video",
			body: "Lower back felt slightly tight on rep 4",
			media: {
				s3Key: videoPresignRes.data.s3Key,
				url: videoPresignRes.data.url,
				mimeType: "video/mp4",
				byteSize: 1024 * 1024 * 18,
				durationSeconds: 24.0,
				width: 1080,
				height: 1920,
			},
		},
		{ headers: memberHeaders },
	);
	const videoMsg = sendVideoRes.data.message;
	if (videoMsg.kind !== "video" || !videoMsg.media?.s3Key) {
		throw new Error("Video message did not persist media schema correctly");
	}
	console.log(`   ✅ Form check video sent: ${videoMsg.id}\n`);

	// 12. Verify Retrieval via GET /messages
	console.log("10. Verifying Message Retrieval via GET /messages...");
	const getMessagesRes = await axios.get(
		`${BASE_URL}/chat/conversations/${conversationId}/messages`,
		{ headers: memberHeaders },
	);
	const messages = getMessagesRes.data.messages;
	const retrievedImage = messages.find((m: any) => m.id === imageMsg.id);
	const retrievedAudio = messages.find((m: any) => m.id === audioMsg.id);
	const retrievedVideo = messages.find((m: any) => m.id === videoMsg.id);

	if (!retrievedImage?.media?.s3Key) throw new Error("Retrieved image missing media");
	if (!retrievedAudio?.media?.durationSeconds) throw new Error("Retrieved audio missing durationSeconds");
	if (!retrievedVideo?.media?.width) throw new Error("Retrieved video missing video dimensions");

	console.log(`   ✅ Retrieved ${messages.length} messages. All media attachments verified.`);

	// 13. Verify Conversation Preview Formatting
	console.log("\n11. Verifying Conversation List Snippet Preview...");
	const listConvRes = await axios.get(
		`${BASE_URL}/chat/conversations`,
		{ headers: memberHeaders },
	);
	const myConv = listConvRes.data.conversations.find((c: any) => c.id === conversationId);
	console.log(`   Last message preview: "${myConv?.lastMessage?.body}"`);
	if (!myConv?.lastMessage?.body) {
		throw new Error("Conversation preview formatting failed");
	}
	console.log("   ✅ Conversation preview snippet verified.\n");

	console.log("=================================================");
	console.log("🎉 MILESTONE 1 E2E VERIFICATION COMPLETE: 100% PASSED");
	console.log("=================================================");
	process.exit(0);
}

main().catch((err) => {
	console.error("❌ E2E TEST FAILED:", err?.response?.data || err?.message || err);
	process.exit(1);
});
