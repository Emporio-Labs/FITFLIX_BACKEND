import { config } from "dotenv";
import mongoose from "mongoose";
import request from "supertest";
import sinon from "sinon";
import app from "../../src/app";
import User from "../../src/models/User";
import { AppSettings } from "../../src/models/AppSettings";
import Service from "../../src/models/Service";
import Slot from "../../src/models/Slots";
import Membership from "../../src/models/Membership";
import { signAuthToken, getJwtConfig } from "../../src/utils/jwt";
import type { AuthenticatedUser } from "../../src/types/auth";

config();

async function generateTestAuthToken(userDoc: any): Promise<string> {
	const authUser: AuthenticatedUser = {
		id: userDoc._id.toString(),
		email: userDoc.email,
		role: "user",
	};
	const jwtConfig = getJwtConfig();
	if (!jwtConfig) throw new Error("JWT config missing");
	return signAuthToken(authUser, jwtConfig);
}

async function runIntegrationTests() {
	console.log("Starting Booking Window Integration Tests...");

	await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/fitflix");

	// Setup App Settings (72 hours window)
	await AppSettings.findOneAndUpdate(
		{ key: "global" },
		{ bookingWindowOpenHours: 72 },
		{ upsert: true, new: true }
	);

	// Create test user
	const user = await User.create({
		email: `integration_test_${Date.now()}@fitflix.com`,
		firstName: "Integration",
		lastName: "Test",
		role: "user",
		onboarded: true,
		gender: "Male",
		age: 30,
		phone: "1234567890",
		username: `integration_test_${Date.now()}`
	});

	const token = await generateTestAuthToken(user);

	// Create test service
	const service = await Service.create({
		title: "Yoga Class",
		serviceName: "Yoga Class",
		description: "Relaxing yoga class",
		creditCost: 1,
		type: "class",
		serviceTime: 60
	});

	// The target class is on July 1, 2026 at 10:00 UTC
	const classStartMs = Date.UTC(2026, 6, 1, 10, 0, 0, 0); // Month is 0-indexed in JS Date! (6 = July)
	const classStartDate = new Date(classStartMs);

	// Give user a membership so they have credits
	await Membership.create({
		user: user._id,
		creditsRemaining: 10,
		status: "Active",
		planName: "Test Plan",
		price: 100,
		startDate: new Date(classStartMs - 100000000),
		endDate: new Date(classStartMs + 100000000),
	});

	const slot = await Slot.create({
		service: service._id,
		date: classStartDate,
		startTime: "10:00",
		endTime: "11:00",
		capacity: 10,
		remainingCapacity: 10,
	});

	await Service.updateOne({ _id: service._id }, { $push: { slots: slot._id } });

	const windowOpenMs = classStartMs - 72 * 60 * 60 * 1000;

	const testPayload = {
		serviceId: service._id.toString(),
		slotId: slot._id.toString(),
		bookingDate: classStartDate.toISOString(),
		bypassBookingWindow: false,
		bypassCredits: false,
	};

	let clock: sinon.SinonFakeTimers;

	try {
		// 1. EARLY REQUEST - 1 hour before window opens
		clock = sinon.useFakeTimers({ now: windowOpenMs - 60 * 60 * 1000, toFake: ["Date"] });
		console.log("\n[Test 1] Simulating Early Request (Before 72h window)...");
		let res = await request(app)
			.post("/bookings")
			.set("Authorization", `Bearer ${token}`)
			.send(testPayload);
		
		if (res.status !== 400 || res.body.code !== "BOOKING_WINDOW_NOT_OPEN") {
			throw new Error(`Expected 400 BOOKING_WINDOW_NOT_OPEN, got ${res.status} ${JSON.stringify(res.body)}`);
		}
		console.log("✅ Passed: Early Request Rejected");
		clock.restore();

		// 2. VALID REQUEST - Inside the 72h window
		clock = sinon.useFakeTimers({ now: classStartMs - 24 * 60 * 60 * 1000, toFake: ["Date"] });
		console.log("\n[Test 2] Simulating Valid Request (Inside window)...");
		res = await request(app)
			.post("/bookings")
			.set("Authorization", `Bearer ${token}`)
			.send(testPayload);
		
		if (res.status !== 201) {
			throw new Error(`Expected 201 Created, got ${res.status} ${JSON.stringify(res.body)}`);
		}
		console.log("✅ Passed: Valid Request Accepted");
		
		// Clean up the created booking so we can book again
		await mongoose.connection.db.collection("bookings").deleteOne({ _id: new mongoose.Types.ObjectId(res.body.booking._id) });
		await Slot.updateOne({ _id: slot._id }, { $inc: { remainingCapacity: 1 } });
		clock.restore();

		// 3. LATE REQUEST - 1 hour after class started
		clock = sinon.useFakeTimers({ now: classStartMs + 60 * 60 * 1000, toFake: ["Date"] });
		console.log("\n[Test 3] Simulating Late Request (After class start)...");
		res = await request(app)
			.post("/bookings")
			.set("Authorization", `Bearer ${token}`)
			.send(testPayload);
		
		if (res.status !== 400 || res.body.code !== "BOOKING_WINDOW_CLOSED") {
			throw new Error(`Expected 400 BOOKING_WINDOW_CLOSED, got ${res.status} ${JSON.stringify(res.body)}`);
		}
		console.log("✅ Passed: Late Request Rejected");
		clock.restore();

		// 4. DUPLICATE BOOKING - Book twice for the same slot
		clock = sinon.useFakeTimers({ now: classStartMs - 24 * 60 * 60 * 1000, toFake: ["Date"] });
		console.log("\n[Test 4] Simulating Duplicate Booking...");
		
		const duplicatePayload = { ...testPayload };

		// First successful booking
		let res1 = await request(app)
			.post("/bookings")
			.set("Authorization", `Bearer ${token}`)
			.send(duplicatePayload);
		
		if (res1.status !== 201) {
			throw new Error(`Expected 201 Created for first booking, got ${res1.status} ${JSON.stringify(res1.body)}`);
		}

		// Second duplicate booking
		let res2 = await request(app)
			.post("/bookings")
			.set("Authorization", `Bearer ${token}`)
			.send(duplicatePayload);
		
		if (res2.status !== 409 || res2.body.code !== "DUPLICATE_BOOKING") {
			throw new Error(`Expected 409 DUPLICATE_BOOKING, got ${res2.status} ${JSON.stringify(res2.body)}`);
		}
		console.log("✅ Passed: Duplicate Booking Rejected");

	} catch (e) {
		console.error("❌ Integration test failed:", e);
		if (clock!) clock.restore();
		process.exit(1);
	}

	console.log("\n🎉 All integration tests passed successfully!");
	process.exit(0);
}

runIntegrationTests().catch(console.error);
