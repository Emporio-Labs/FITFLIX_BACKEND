import { config } from "dotenv";
config();
import mongoose from "mongoose";
import app from "../src/app";
import User from "../src/models/User";
import Slot from "../src/models/Slots";
import NutritionistBooking from "../src/models/NutritionistBooking";
import ExpertAppointment from "../src/models/ExpertAppointment";
import { signAuthToken, getJwtConfig } from "../src/utils/jwt";
import { AppointmentBookingStatus } from "../src/models/Enums";

const PORT = 4444;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
	console.log("=== STARTING NUTRITIONIST DUPLICATE BOOKING TESTS ===");

	const mongoUrl = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/hybridhuman";
	await mongoose.connect(mongoUrl);
	console.log("Connected to MongoDB.");

	// Start test HTTP server
	const server = app.listen(PORT, () => {
		console.log(`Test server running on port ${PORT}`);
	});

	const stamp = Date.now();
	const email = `testuser_${stamp}@test.com`;

	// Create test user
	const user = await User.create({
		username: `testuser_${stamp}`,
		email,
		phone: `999000${stamp.toString().slice(-4)}`,
		age: 25,
		gender: "Male",
		onboarded: false,
	});

	console.log(`Created test User: ${user._id}`);

	// Generate token
	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		throw new Error("JWT_SECRET is not configured");
	}

	const token = signAuthToken({ id: user._id.toString(), email, role: "user" }, jwtConfig);

	// Create two slots
	const slot1 = await Slot.create({
		date: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
		startTime: "10:00",
		endTime: "10:30",
		capacity: 1,
		remainingCapacity: 1,
		isDaily: false,
	});

	const slot2 = await Slot.create({
		date: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
		startTime: "11:00",
		endTime: "11:30",
		capacity: 1,
		remainingCapacity: 1,
		isDaily: false,
	});

	const assertResponse = async (method: string, path: string, token: string, bodyObj: any, expectedStatus: number) => {
		const res = await fetch(`${BASE_URL}${path}`, {
			method,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(bodyObj),
		});

		const text = await res.text();
		console.log(`Response for ${method} ${path}: [Status ${res.status}] ${text}`);
		
		if (res.status !== expectedStatus) {
			throw new Error(`FAIL: ${method} ${path} returned ${res.status}, expected ${expectedStatus}. Response: ${text}`);
		}
		console.log(`PASS: ${method} ${path} returned ${res.status}`);
		return JSON.parse(text);
	};

	try {
		// 1. Try first booking (should succeed)
		console.log("\n--- Booking First Appointment (Slot 1) ---");
		const dateStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
		const booking1Res = await assertResponse(
			"POST",
			"/onboarding/nutritionist/book",
			token,
			{
				slotId: slot1._id.toString(),
				date: dateStr,
				appointmentMode: "IN_PERSON",
			},
			201
		);

		// 2. Try second booking (should be blocked by race guard and return 409 Conflict)
		console.log("\n--- Attempting Duplicate Booking (Slot 2) ---");
		await assertResponse(
			"POST",
			"/onboarding/nutritionist/book",
			token,
			{
				slotId: slot2._id.toString(),
				date: dateStr,
				appointmentMode: "IN_PERSON",
			},
			409
		);

		// 3. Mark the first booking as completed in DB, and try booking again (should still be blocked because user already had a completed booking)
		console.log("\n--- Marking Booking 1 as COMPLETED and Attempting Booking again ---");
		await NutritionistBooking.findByIdAndUpdate(booking1Res.booking._id, {
			$set: { bookingStatus: "COMPLETED" },
		});

		await assertResponse(
			"POST",
			"/onboarding/nutritionist/book",
			token,
			{
				slotId: slot2._id.toString(),
				date: dateStr,
				appointmentMode: "IN_PERSON",
			},
			409
		);

		// 4. Test database unique constraint violation (Mongo E11000) check
		// Let's create an ExpertAppointment for this user, then mark it completed.
		// If the user attempts to book via Cal.id (which uses slotId with "T" or "-"),
		// we first verify that the race guard blocks it.
		console.log("\n--- Testing Cal.id / ExpertAppointment Duplicate Booking ---");
		// Let's insert a dummy ExpertAppointment directly to simulate it
		const appt1 = await ExpertAppointment.create({
			userId: user._id,
			expertType: "nutritionist",
			bookingStatus: AppointmentBookingStatus.Confirmed,
			appointmentStart: new Date(),
			appointmentEnd: new Date(),
		});

		// Try booking a Cal.id slot. Should be blocked by race guard and return 409 Conflict.
		await assertResponse(
			"POST",
			"/onboarding/nutritionist/book",
			token,
			{
				slotId: "2026-06-15T10:00:00Z", // Cal.id style slotId containing T
				date: "2026-06-15",
				appointmentMode: "ONLINE",
				email: email,
			},
			409
		);

		console.log("\n✅ ALL NUTRITIONIST DUPLICATE BOOKING TESTS PASSED SUCCESSFULLY!");
	} finally {
		// Clean up
		console.log("\nCleaning up test documents...");
		await User.deleteOne({ _id: user._id });
		await Slot.deleteMany({ _id: { $in: [slot1._id, slot2._id] } });
		await NutritionistBooking.deleteMany({ user: user._id });
		await ExpertAppointment.deleteMany({ userId: user._id });

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
