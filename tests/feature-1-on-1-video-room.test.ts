import mongoose from "mongoose";
import NutritionistBooking from "../src/models/NutritionistBooking";
import User from "../src/models/User";
import {
	adminToken,
	fetchJson,
	generateTestToken,
	startTestServer,
	type TestServerInstance,
} from "./test-helpers";

async function run1on1VideoRoomTests() {
	console.log("=== Feature Test: 1-on-1 Video Room Generation & Nutritionist Assignment ===");

	let testServer: TestServerInstance | null = null;
	const testUserId = new mongoose.Types.ObjectId().toString();
	const testNutritionistId = new mongoose.Types.ObjectId().toString();
	const memberToken = generateTestToken("user", testUserId);

	try {
		testServer = await startTestServer();
		const { baseUrl } = testServer;

		// Seed test user with onboarding status
		await User.findByIdAndUpdate(
			testUserId,
			{
				username: "test_member",
				phone: "+15550001111",
				age: 30,
				gender: "Male",
				onboardingStatus: {
					currentStep: "REPORT_UPLOAD",
					completedSteps: ["HEALTH_MARKERS", "HEALTH_GOALS", "CONSENT"],
					healthMarkersCompleted: true,
					healthGoalsCompleted: true,
					consentCompleted: true,
					reportsUploaded: false,
					onboardingCompleted: false,
				},
			},
			{ upsert: true },
		);

		// Seed nutritionist staff user
		await User.findByIdAndUpdate(
			testNutritionistId,
			{
				username: "Dr. Sarah Jenkins",
				phone: "+15550002222",
				age: 35,
				gender: "Female",
				status: "ACTIVE",
			},
			{ upsert: true },
		);

		// Clean up old bookings for test user
		await NutritionistBooking.deleteMany({ userId: new mongoose.Types.ObjectId(testUserId) });

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 1: Book online nutritionist appointment -> Auto-generate zegoRoomId
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 1] POST /onboarding/nutritionist/book (ONLINE mode)");
		const bookRes = await fetchJson(baseUrl, "/onboarding/nutritionist/book", {
			method: "POST",
			token: memberToken,
			body: {
				date: new Date(Date.now() + 86400000).toISOString(),
				startTime: "11:00",
				endTime: "11:30",
				appointmentMode: "ONLINE",
				notes: "Initial consultation",
			},
		});

		console.log("Status:", bookRes.status);
		console.log("Data:", JSON.stringify(bookRes.data, null, 2));

		if (bookRes.status !== 201 || !bookRes.data.booking) {
			throw new Error("Failed TEST 1: Booking creation failed");
		}

		const bookingId = bookRes.data.booking._id;
		const zegoRoomId = bookRes.data.booking.zegoRoomId;

		if (!zegoRoomId || !zegoRoomId.startsWith("nutri_session_")) {
			throw new Error(`Failed TEST 1: Expected zegoRoomId starting with nutri_session_, got: ${zegoRoomId}`);
		}
		console.log("✅ TEST 1 Passed: Auto-generated zegoRoomId =", zegoRoomId);

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 2: GET /onboarding/status returns zegoRoomId in bookingDetails
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 2] GET /onboarding/status");
		const statusRes = await fetchJson(baseUrl, "/onboarding/status", {
			method: "GET",
			token: memberToken,
		});

		console.log("Status:", statusRes.status);
		console.log("Data:", JSON.stringify(statusRes.data, null, 2));

		if (statusRes.status !== 200 || !statusRes.data.bookingDetails) {
			throw new Error("Failed TEST 2: getOnboardingStatus missing bookingDetails");
		}

		if (statusRes.data.bookingDetails.zegoRoomId !== zegoRoomId) {
			throw new Error(`Failed TEST 2: zegoRoomId mismatch in getOnboardingStatus`);
		}
		console.log("✅ TEST 2 Passed: bookingDetails in getOnboardingStatus verified.");

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 3: Admin accepts booking and assigns nutritionist
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 3] PATCH /admin/nutrition/bookings/:id/accept");
		const acceptRes = await fetchJson(
			baseUrl,
			`/admin/nutrition/bookings/${bookingId}/accept`,
			{
				method: "PATCH",
				token: adminToken,
				body: {
					assignedNutritionistId: testNutritionistId,
					assignedNutritionistName: "Dr. Sarah Jenkins",
					clinicLocation: "Virtual Suite 1",
				},
			},
		);

		console.log("Status:", acceptRes.status);
		console.log("Data:", JSON.stringify(acceptRes.data, null, 2));

		if (acceptRes.status !== 200 || acceptRes.data.booking.status !== "ACCEPTED") {
			throw new Error("Failed TEST 3: Accept booking failed");
		}

		if (acceptRes.data.booking.assignedNutritionistName !== "Dr. Sarah Jenkins") {
			throw new Error("Failed TEST 3: assignedNutritionistName mismatch");
		}
		console.log("✅ TEST 3 Passed: Nutritionist assigned successfully.");

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 4: GET /nutritionist/my-booking returns zegoRoomId & assigned staff
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 4] GET /nutritionist/my-booking");
		const myBookingRes = await fetchJson(baseUrl, "/nutritionist/my-booking", {
			method: "GET",
			token: memberToken,
		});

		console.log("Status:", myBookingRes.status);
		console.log("Data:", JSON.stringify(myBookingRes.data, null, 2));

		if (
			myBookingRes.status !== 200 ||
			myBookingRes.data.booking.zegoRoomId !== zegoRoomId ||
			myBookingRes.data.booking.assignedNutritionistName !== "Dr. Sarah Jenkins"
		) {
			throw new Error("Failed TEST 4: GET /nutritionist/my-booking payload incomplete");
		}
		console.log("✅ TEST 4 Passed: GET /nutritionist/my-booking verified.");

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 5: Generate ZEGOCLOUD Token passing zegoRoomId
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 5] POST /api/v1/zego/token with conferenceId = zegoRoomId");
		// Set fake zego env vars for test server if missing
		process.env.ZEGO_APP_ID = process.env.ZEGO_APP_ID || "12345678";
		process.env.ZEGO_SERVER_SECRET = process.env.ZEGO_SERVER_SECRET || "12345678901234567890123456789012";

		const zegoTokenRes = await fetchJson(baseUrl, "/api/v1/zego/token", {
			method: "POST",
			token: memberToken,
			body: {
				conferenceId: zegoRoomId,
			},
		});

		console.log("Status:", zegoTokenRes.status);
		console.log("Data:", JSON.stringify(zegoTokenRes.data, null, 2));

		if (zegoTokenRes.status !== 200 || !zegoTokenRes.data.token) {
			throw new Error("Failed TEST 5: ZEGOCLOUD token generation failed");
		}
		console.log("✅ TEST 5 Passed: ZEGOCLOUD token generated for 1-on-1 video room.");

		// ──────────────────────────────────────────────────────────────────────────
		// TEST 6: Switch to Online Mode attaches zegoRoomId if missing
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n[TEST 6] POST /nutritionist/my-booking/switch-to-online");
		// Create an IN_PERSON booking first
		const inPersonBooking = new NutritionistBooking({
			userId: new mongoose.Types.ObjectId(testUserId),
			bookingDate: new Date(Date.now() + 172800000),
			startTime: "14:00",
			endTime: "14:30",
			appointmentMode: "IN_PERSON",
			clinicLocation: "Downtown Clinic",
			status: "PENDING",
		});
		await inPersonBooking.save();

		const switchRes = await fetchJson(baseUrl, "/nutritionist/my-booking/switch-to-online", {
			method: "POST",
			token: memberToken,
			body: {
				notes: "Changed mind to online call",
			},
		});

		console.log("Status:", switchRes.status);
		console.log("Data:", JSON.stringify(switchRes.data, null, 2));

		if (
			switchRes.status !== 200 ||
			switchRes.data.booking.appointmentMode !== "ONLINE" ||
			!switchRes.data.booking.zegoRoomId
		) {
			throw new Error("Failed TEST 6: Switch to online failed to attach zegoRoomId");
		}
		console.log("✅ TEST 6 Passed: Switch to online mode attached zegoRoomId successfully.");

		console.log("\n🎉 ALL 1-ON-1 VIDEO ROOM & NUTRITIONIST ASSIGNMENT TESTS PASSED CLEANLY!");
	} catch (err) {
		console.error("\n❌ TEST FAILED:", err);
		process.exit(1);
	} finally {
		if (testServer) {
			await testServer.close();
		}
		if (mongoose.connection.readyState !== 0) {
			await mongoose.disconnect();
		}
	}
}

run1on1VideoRoomTests();
