import { config } from "dotenv";
config();
import mongoose from "mongoose";
import app from "../src/app";
import User from "../src/models/User";
import Slot from "../src/models/Slots";
import Service from "../src/models/Service";
import Booking from "../src/models/Bookings";
import { signAuthToken, getJwtConfig } from "../src/utils/jwt";
import { BookingStatus } from "../src/models/Enums";

const PORT = 4444;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
	console.log("=== STARTING BACKEND SECURITY ROLE-BASED ACCESS CONTROL TESTS ===");

	const mongoUrl = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/hybridhuman";
	await mongoose.connect(mongoUrl);
	console.log("Connected to MongoDB.");

	// Start test HTTP server
	const server = app.listen(PORT, () => {
		console.log(`Test server running on port ${PORT}`);
	});

	const stamp = Date.now();
	const emailA = `usera_${stamp}@test.com`;
	const emailB = `userb_${stamp}@test.com`;

	// Create test users
	const userA = await User.create({
		username: `usera_${stamp}`,
		email: emailA,
		phone: `9000000001`,
		age: 25,
		gender: "Male",
		onboarded: true,
	});

	const userB = await User.create({
		username: `userb_${stamp}`,
		email: emailB,
		phone: `9000000002`,
		age: 26,
		gender: "Female",
		onboarded: true,
	});

	console.log(`Created test User A: ${userA._id} and User B: ${userB._id}`);

	// Generate tokens
	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		throw new Error("JWT_SECRET is not configured");
	}

	const tokenA = signAuthToken({ id: userA._id.toString(), email: emailA, role: "user" }, jwtConfig);
	const tokenB = signAuthToken({ id: userB._id.toString(), email: emailB, role: "user" }, jwtConfig);

	// Create mock slot and service
	const slot = await Slot.create({
		date: new Date(),
		startTime: "10:00",
		endTime: "11:00",
		capacity: 1,
		remainingCapacity: 1,
		isDaily: false,
	});

	const service = await Service.create({
		serviceName: "IV Therapy Test",
		serviceType: "Therapy",
		serviceTime: 60,
		description: "IV Therapy Test description",
		creditCost: 1,
		slots: [slot._id],
	});

	// Create User A booking
	const bookingA = await Booking.create({
		bookingDate: new Date(),
		startTime: "10:00",
		endTime: "11:00",
		status: BookingStatus.Booked,
		user: userA._id,
		slot: slot._id,
		service: service._id,
		creditCostSnapshot: 1,
		creditsBypassed: false,
	});

	console.log(`Created test Booking for User A: ${bookingA._id}`);

	const assertResponse = async (method: string, path: string, token: string, expectedStatus: number, bodyObj?: any) => {
		const res = await fetch(`${BASE_URL}${path}`, {
			method,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: bodyObj ? JSON.stringify(bodyObj) : undefined,
		});

		if (res.status !== expectedStatus) {
			const text = await res.text();
			throw new Error(`FAIL: ${method} ${path} returned ${res.status}, expected ${expectedStatus}. Response: ${text}`);
		}
		console.log(`PASS: ${method} ${path} returned ${res.status}`);
	};

	try {
		// 1. Test User Profile GET /users/:id
		console.log("\n--- Testing GET /users/:id ---");
		await assertResponse("GET", `/users/${userA._id}`, tokenA, 200);
		await assertResponse("GET", `/users/${userA._id}`, tokenB, 403);

		// 2. Test User Profile GET /users/:id/onboarding-profile
		console.log("\n--- Testing GET /users/:id/onboarding-profile ---");
		await assertResponse("GET", `/users/${userA._id}/onboarding-profile`, tokenA, 200);
		await assertResponse("GET", `/users/${userA._id}/onboarding-profile`, tokenB, 403);

		// 3. Test GET /credits/users/:userId/balance
		console.log("\n--- Testing GET /credits/users/:userId/balance ---");
		await assertResponse("GET", `/credits/users/${userA._id}/balance`, tokenA, 200);
		await assertResponse("GET", `/credits/users/${userA._id}/balance`, tokenB, 403);

		// 4. Test GET /credits/users/:userId/history
		console.log("\n--- Testing GET /credits/users/:userId/history ---");
		await assertResponse("GET", `/credits/users/${userA._id}/history`, tokenA, 200);
		await assertResponse("GET", `/credits/users/${userA._id}/history`, tokenB, 403);

		// 5. Test GET /bookings/:id
		console.log("\n--- Testing GET /bookings/:id ---");
		await assertResponse("GET", `/bookings/${bookingA._id}`, tokenA, 200);
		await assertResponse("GET", `/bookings/${bookingA._id}`, tokenB, 403);

		// 6. Test PATCH /bookings/:id/status
		console.log("\n--- Testing PATCH /bookings/:id/status ---");
		await assertResponse("PATCH", `/bookings/${bookingA._id}/status`, tokenB, 403, { status: BookingStatus.Cancelled });
		await assertResponse("PATCH", `/bookings/${bookingA._id}/status`, tokenA, 200, { status: BookingStatus.Cancelled });

		// 7. Test DELETE /bookings/:id
		console.log("\n--- Testing DELETE /bookings/:id ---");
		// Create another booking for user A to test DELETE
		const bookingA2 = await Booking.create({
			bookingDate: new Date(),
			startTime: "10:00",
			endTime: "11:00",
			status: BookingStatus.Booked,
			user: userA._id,
			slot: slot._id,
			service: service._id,
			creditCostSnapshot: 1,
			creditsBypassed: false,
		});
		await assertResponse("DELETE", `/bookings/${bookingA2._id}`, tokenB, 403);
		await assertResponse("DELETE", `/bookings/${bookingA2._id}`, tokenA, 200);

		console.log("\n✅ ALL ROLE-BASED ACCESS CONTROL TESTS PASSED SUCCESSFULLY!");
	} finally {
		// Clean up
		console.log("\nCleaning up test documents...");
		await User.deleteMany({ _id: { $in: [userA._id, userB._id] } });
		await Slot.deleteOne({ _id: slot._id });
		await Service.deleteOne({ _id: service._id });
		await Booking.deleteMany({ user: { $in: [userA._id, userB._id] } });

		server.close(() => {
			console.log("Test server closed.");
		});
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB.");
	}
}

runTests().catch((err) => {
	console.error("FAIL: Test execution encountered an error:", err);
	process.exit(1);
});
