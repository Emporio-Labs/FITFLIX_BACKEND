import mongoose from "mongoose";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import {
	allocateSeatAtomic,
	releaseSeatAtomic,
} from "../src/services/capacity-engine.service";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runFeature011Tests() {
	console.log(
		"=== Feature Test: FEATURE-011 Capacity Management Engine ===",
	);
	const { baseUrl, close } = await startTestServer();

	let testClassId = "";
	let testSessionId = "";

	try {
		console.log("\n1. Creating test Class and Session with Capacity = 5...");
		const testClass = await ClassModel.create({
			name: "Concurrency Test Class",
			creditCost: 3,
			maxParticipants: 5,
		});
		testClassId = testClass._id.toString();

		const testSession = await ScheduledSession.create({
			classId: testClassId,
			sessionDate: new Date(Date.now() + 86400000 * 3),
			startTime: "10:00",
			endTime: "11:00",
			deliveryType: "OFFLINE",
			capacity: 5,
			currentBookings: 0,
			remainingCapacity: 5,
			status: "SCHEDULED",
			isPublished: true,
		});
		testSessionId = testSession._id.toString();
		assert(Boolean(testSessionId), "Test session created with capacity 5");

		console.log(
			"\n2. Testing Race Condition Prevention (25 Simultaneous Concurrent Bookings)...",
		);
		const bookingAttempts = Array.from({ length: 25 }, () =>
			allocateSeatAtomic(testSessionId),
		);

		const results = await Promise.all(bookingAttempts);
		const successfulAllocations = results.filter((r) => r.success);
		const failedAllocations = results.filter((r) => !r.success);

		assert(
			successfulAllocations.length === 5,
			`Exactly 5 concurrent allocations succeeded (Got: ${successfulAllocations.length})`,
		);
		assert(
			failedAllocations.length === 20,
			`Exactly 20 concurrent allocations failed safely (Got: ${failedAllocations.length})`,
		);

		console.log("\n3. Testing Automated Status Synchronization to 'FULL'...");
		const fullSession = await ScheduledSession.findById(testSessionId);
		assert(
			fullSession?.currentBookings === 5,
			"currentBookings is exactly equal to configured capacity (5)",
		);
		assert(
			fullSession?.remainingCapacity === 0,
			"remainingCapacity is exactly 0",
		);
		assert(
			fullSession?.status === "FULL",
			"Session status automatically transitioned to 'FULL'",
		);

		console.log(
			"\n4. Testing Atomic Seat Release & Status Restoration to 'SCHEDULED'...",
		);
		const releaseResult = await releaseSeatAtomic(testSessionId);
		assert(releaseResult.success === true, "Seat released successfully");
		const restoredSession = await ScheduledSession.findById(testSessionId);
		assert(
			restoredSession?.currentBookings === 4,
			"currentBookings decremented to 4",
		);
		assert(
			restoredSession?.remainingCapacity === 1,
			"remainingCapacity restored to 1",
		);
		assert(
			restoredSession?.status === "SCHEDULED",
			"Session status automatically restored to 'SCHEDULED'",
		);

		console.log(
			"\n5. Testing Capacity Reduction Protection (400 Bad Request)...",
		);
		const invalidReductionRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/schedule/${testSessionId}/capacity`,
			{
				token: adminToken,
				method: "PATCH",
				body: { capacity: 2 },
			},
		);
		assert(
			invalidReductionRes.status === 400,
			"Reducing capacity (2) below confirmed bookings (4) returns 400 Bad Request",
		);

		console.log("\n6. Testing Valid Capacity Update Endpoint...");
		const validCapacityRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/schedule/${testSessionId}/capacity`,
			{
				token: adminToken,
				method: "PATCH",
				body: { capacity: 10 },
			},
		);
		assert(
			validCapacityRes.status === 200,
			"PATCH /api/v1/admin/classes/schedule/:id/capacity returns 200 OK",
		);
		const updatedSession = validCapacityRes.data.session;
		assert(
			updatedSession.capacity === 10,
			"Total capacity updated to 10",
		);
		assert(
			updatedSession.remainingCapacity === 6,
			"remainingCapacity recalculated to 6 (10 capacity - 4 confirmed)",
		);

		console.log(
			"\n🎉 FEATURE-011 Capacity Management Engine Tests Passed!",
		);
	} finally {
		if (testSessionId) {
			await ScheduledSession.findByIdAndDelete(testSessionId);
		}
		if (testClassId) {
			await ClassModel.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runFeature011Tests().catch((err) => {
	console.error("Capacity engine test failed:", err);
	process.exit(1);
});
