import { config } from "dotenv";
import mongoose from "mongoose";
import request from "supertest";
import app from "../../src/app";
import User from "../../src/models/User";
import Service from "../../src/models/Service";
import Slot from "../../src/models/Slots";
import Booking from "../../src/models/Bookings";
import { BookingStatus } from "../../src/models/Enums";
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

async function runCancelTests() {
	console.log("Starting Booking Cancel Integration Tests...");

	await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/fitflix");

	// Create test users
	const user1 = await User.create({
		email: `cancel_test1_${Date.now()}@fitflix.com`,
		firstName: "Cancel",
		lastName: "Test1",
		role: "user",
		onboarded: true,
		gender: "Male",
		age: 30,
		phone: "1111111111",
		username: `cancel_test1_${Date.now()}`
	});

	const user2 = await User.create({
		email: `cancel_test2_${Date.now()}@fitflix.com`,
		firstName: "Cancel",
		lastName: "Test2",
		role: "user",
		onboarded: true,
		gender: "Female",
		age: 28,
		phone: "2222222222",
		username: `cancel_test2_${Date.now()}`
	});

	const token1 = await generateTestAuthToken(user1);
	const token2 = await generateTestAuthToken(user2);

	const service = await Service.create({
		title: "Cancel Yoga",
		serviceName: "Cancel Yoga",
		description: "Cancel Yoga class",
		creditCost: 1,
		type: "class",
		serviceTime: 60,
	});

	const slot = await Slot.create({
		service: service._id,
		date: new Date(),
		startTime: "10:00",
		endTime: "11:00",
		capacity: 10,
		remainingCapacity: 9,
	});

	const booking = await Booking.create({
		user: user1._id,
		slot: slot._id,
		service: service._id,
		bookingDate: new Date(),
		startTime: "10:00",
		endTime: "11:00",
		status: BookingStatus.Booked,
		creditCostSnapshot: 1,
		creditsBypassed: true,
	});

	try {
		// Test 1: Reject request with 403 Forbidden if user2 attempts to cancel user1's booking
		console.log("\n[Test 1] Unauthorized cancellation...");
		console.log("Token1:", token1);
		console.log("JWT Config used for token1:", getJwtConfig());

		let res = await request(app)
			.delete(`/bookings/${booking._id}`)
			.set("Authorization", `Bearer ${token2}`);
		
		console.log("Response status:", res.status);
		console.log("Response body:", res.body);

		if (res.status !== 403) {
			throw new Error(`Expected 403 Forbidden, got ${res.status} ${JSON.stringify(res.body)}`);
		}
		console.log("✅ Passed: Unauthorized user rejected with 403");

		// Test 2: Successful cancellation by the owner
		console.log("\n[Test 2] Authorized cancellation...");
		res = await request(app)
			.delete(`/bookings/${booking._id}`)
			.set("Authorization", `Bearer ${token1}`);
		
		if (res.status !== 200 && res.status !== 204) {
			throw new Error(`Expected 200 or 204, got ${res.status} ${JSON.stringify(res.body)}`);
		}
		console.log("✅ Passed: Owner cancelled successfully");

		// Test 3: Check database state transitions and capacity re-evaluation
		console.log("\n[Test 3] Verifying database state...");
	const updatedBooking = await Booking.findById(booking._id);
	console.log("Updated Booking:", updatedBooking?.toJSON());
	if (!updatedBooking || Number(updatedBooking.status) !== BookingStatus.Cancelled || !updatedBooking.cancelledAt) {
		throw new Error(`Booking status not updated to CANCELLED or cancelledAt missing: status=${updatedBooking?.status}, cancelledAt=${updatedBooking?.cancelledAt}`);
	}	

		const updatedSlot = await Slot.findById(slot._id);
		if (updatedSlot!.remainingCapacity !== 10) {
			throw new Error(`Slot capacity not increased, expected 10 got ${updatedSlot!.remainingCapacity}`);
		}
		console.log("✅ Passed: Database state and capacity updated");

	} catch (e) {
		console.error("❌ Test failed:", e);
		process.exit(1);
	}

	console.log("\n🎉 All cancel integration tests passed successfully!");
	process.exit(0);
}

runCancelTests().catch(console.error);
