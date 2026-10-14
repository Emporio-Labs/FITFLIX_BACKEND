import mongoose from "mongoose";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import Booking from "../src/models/Bookings";
import Membership from "../src/models/Membership";
import Recording from "../src/models/Recording";
import {
	startRoomRecording,
	stopRoomRecording,
	generateSignedPlaybackToken,
	verifyPlaybackToken,
} from "../src/services/zego-recording.service";
import { checkReplayAccess } from "../src/services/replay-access.service";
import { assert } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Livestream Replay & Recording Lifecycle (FX-23) Tests...");

	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	const testSessionId = `test_session_${Date.now()}`;
	const testClassId = `test_class_${Date.now()}`;
	const instructorId = new mongoose.Types.ObjectId().toString();
	const memberId = new mongoose.Types.ObjectId().toString();
	const strangerId = new mongoose.Types.ObjectId().toString();

	// ── FX-23.1: Scoping check: Group class MUST NOT be recorded ──
	console.log("\n🔎 FX-23.1: In-studio group classes are NOT recorded");
	const groupClassDoc = {
		_id: testClassId,
		name: "In-Studio Kettlebell Blast",
		instructor: "Trainer Vikram",
		instructorUserId: instructorId,
		sessionType: "group_class",
		access: "members_only",
		bookingRequirement: "credits_required",
	};

	const groupClassSession = {
		_id: testSessionId,
		classId: testClassId,
		videoRoomId: `gc_${testSessionId}`,
	};

	const groupClassRec = await startRoomRecording(groupClassSession, groupClassDoc);
	assert(groupClassRec === null, "Group class should return null and NOT trigger cloud recording");

	// ── FX-23.1: Live stream IS recorded from host live ──
	console.log("\n🔎 FX-23.1: Live stream IS recorded when host goes live");
	const liveStreamClassDoc = {
		_id: testClassId,
		name: "Live HIIT & Core Burn",
		instructor: "Coach Maya",
		instructorUserId: instructorId,
		sessionType: "live_stream",
		access: "members_only",
		bookingRequirement: "free",
	};

	const liveStreamSession = {
		_id: testSessionId,
		classId: testClassId,
		videoRoomId: `ls_${testSessionId}`,
	};

	const recording = await startRoomRecording(liveStreamSession, liveStreamClassDoc);
	assert(recording !== null, "Recording document should be created for live_stream");
	assert(recording?.status === "RECORDING", "Status should be RECORDING");
	assert(recording?.sessionType === "live_stream", "Session type should be live_stream");
	assert(recording?.title === "Live HIIT & Core Burn", "Title matches live stream class");
	assert(recording?.instructorName === "Coach Maya", "Instructor matches");

	// Test idempotency
	const duplicateRec = await startRoomRecording(liveStreamSession, liveStreamClassDoc);
	assert(String(duplicateRec?._id) === String(recording?._id), "Second startRoomRecording call should return existing document");

	// ── FX-23.1 & FX-23.2: Stop recording on session end ──
	console.log("\n🔎 FX-23.1 & FX-23.2: Stop recording on stream end and mark READY with duration");
	const endedAt = new Date(recording!.startedAt.getTime() + 45 * 60 * 1000); // 45 minutes later
	const finalized = await stopRoomRecording(liveStreamSession, endedAt);
	assert(finalized !== null, "Finalized recording returned");
	assert(finalized?.status === "READY", "Status transitions to READY");
	assert(finalized?.durationSeconds === 45 * 60, "Duration calculated accurately in seconds (2700s)");

	// ── FX-23.3: Entitlement access checks ──
	console.log("\n🔎 FX-23.3: Entitled members can play replay; strangers cannot");
	// Staff override
	const staffAccess = await checkReplayAccess(strangerId, "admin", finalized!);
	assert(staffAccess.allowed === true, "Admin staff has access");

	// Session trainer
	const trainerAccess = await checkReplayAccess(instructorId, "trainer", finalized!);
	assert(trainerAccess.allowed === true, "Session instructor has access");

	// Stranger without booking or membership
	const strangerAccess = await checkReplayAccess(strangerId, "user", finalized!);
	assert(strangerAccess.allowed === false, "Stranger without booking or membership is rejected");
	assert(strangerAccess.code === "ENTITLEMENT_REQUIRED", "Rejection code is ENTITLEMENT_REQUIRED");

	// Member with active membership
	const membership = await Membership.create({
		user: memberId,
		planName: "All-Access Live",
		price: 4999,
		creditsIncluded: 100,
		creditsRemaining: 100,
		status: "Active",
		startDate: new Date(),
		endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
	});

	const memberAccess = await checkReplayAccess(memberId, "user", finalized!);
	assert(memberAccess.allowed === true, "Member with active membership is allowed to watch replay");

	// ── FX-23.4: Admin visibility and soft-deletion ──
	console.log("\n🔎 FX-23.4: Admin hide and delete controls");
	finalized!.isHidden = true;
	await finalized!.save();
	const hiddenQuery = await Recording.findOne({ _id: finalized!._id, isHidden: false, isDeleted: false });
	assert(hiddenQuery === null, "Hidden recording is excluded from member replay listing");

	finalized!.isHidden = false;
	finalized!.isDeleted = true;
	await finalized!.save();
	const deletedQuery = await Recording.findOne({ _id: finalized!._id, isHidden: false, isDeleted: false });
	assert(deletedQuery === null, "Deleted recording is excluded from member replay listing");

	// ── FX-23.5: Signed playback token and expiration ──
	console.log("\n🔎 FX-23.5: Short-lived signed playback link expires after TTL");
	const recId = String(finalized!._id);
	const { token, expiresAt } = generateSignedPlaybackToken(recId, memberId, 900); // 15 mins
	assert(typeof token === "string" && token.split(".").length === 3, "Signed token has 3 parts (expiresAt.userId.sig)");

	const validCheck = verifyPlaybackToken(recId, token);
	assert(validCheck.valid === true, "Token is valid immediately");
	assert(validCheck.userId === memberId, "Token extracts correct userId");

	// Expired token test (token created with past expiry)
	const expiredTime = Math.floor(Date.now() / 1000) - 10; // 10 seconds ago
	const { token: expiredToken } = generateSignedPlaybackToken(recId, memberId, -10);
	const expiredCheck = verifyPlaybackToken(recId, expiredToken);
	assert(expiredCheck.valid === false, "Expired token fails validation");
	assert(expiredCheck.reason === "Link expired", "Reason is Link expired");

	// Tampered token test
	const tamperedToken = `${token}tampered`;
	const tamperedCheck = verifyPlaybackToken(recId, tamperedToken);
	assert(tamperedCheck.valid === false, "Tampered token fails validation");

	// Clean up test data
	await Recording.deleteMany({ sessionId: testSessionId });
	await Membership.deleteOne({ _id: membership._id });

	console.log("\n🎉 ALL FX-23 RECORDING & REPLAY TESTS PASSED SUCCESSFULLY!\n");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("❌ Test run failed:", err);
	process.exit(1);
});
