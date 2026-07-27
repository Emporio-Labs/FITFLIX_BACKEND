import mongoose from "mongoose";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runFeature010Tests() {
	console.log(
		"=== Feature Test: FEATURE-010 Class Scheduling (Sessions) ===",
	);
	const { baseUrl, close } = await startTestServer();

	let testClassId = "";
	const trainerId = new mongoose.Types.ObjectId().toString();

	try {
		console.log("\n1. Creating test Class base record...");
		const testClass = await ClassModel.create({
			name: "Spinning Roster Class",
			description: "High energy indoor cycling session",
			status: "ACTIVE",
			creditCost: 4,
			mode: "offline",
			instructor: "Master Trainer Alex",
			maxParticipants: 20,
			isPublished: true,
		});
		testClassId = testClass._id.toString();
		assert(Boolean(testClassId), "Test class created successfully");

		const futureDateStr = new Date(Date.now() + 86400000 * 5)
			.toISOString()
			.split("T")[0];

		console.log(
			"\n2. Testing Schedule Generation (Single & Recurring Sessions)...",
		);
		const singleSessionRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
				method: "POST",
				body: {
					classId: testClassId,
					trainerId,
					sessionDate: futureDateStr,
					startTime: "09:00",
					endTime: "10:00",
					deliveryType: "OFFLINE",
					locationAddress: "Studio A",
					capacity: 15,
					recurrenceRule: "NONE",
				},
			},
		);

		assert(
			singleSessionRes.status === 201,
			"POST /api/v1/admin/classes/schedule (Single) returns 201 Created",
		);
		assert(
			singleSessionRes.data.count === 1,
			"Single session created successfully",
		);
		const createdSessionId = singleSessionRes.data.sessions[0]._id;

		const recurringRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
				method: "POST",
				body: {
					classId: testClassId,
					sessionDate: new Date(Date.now() + 86400000 * 10)
						.toISOString()
						.split("T")[0],
					startTime: "14:00",
					endTime: "15:00",
					deliveryType: "ONLINE",
					recurrenceRule: "WEEKLY",
					repeatCount: 3,
				},
			},
		);

		assert(
			recurringRes.status === 201,
			"POST /api/v1/admin/classes/schedule (Recurring WEEKLY) returns 201 Created",
		);
		assert(
			recurringRes.data.count === 3,
			"Generated 3 weekly recurring sessions",
		);

		console.log("\n3. Testing Timeline Constraints (400 Bad Request)...");
		const invalidTimeRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
				method: "POST",
				body: {
					classId: testClassId,
					sessionDate: futureDateStr,
					startTime: "11:00",
					endTime: "10:00",
				},
			},
		);
		assert(
			invalidTimeRes.status === 400,
			"End time before start time returns 400 Bad Request",
		);

		const pastDateRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
				method: "POST",
				body: {
					classId: testClassId,
					sessionDate: "2020-01-01",
					startTime: "09:00",
					endTime: "10:00",
				},
			},
		);
		assert(
			pastDateRes.status === 400,
			"Scheduling session in past date returns 400 Bad Request",
		);

		console.log("\n4. Testing Trainer Overlap Conflict Validation (409 Conflict)...");
		const conflictRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
				method: "POST",
				body: {
					classId: testClassId,
					trainerId,
					sessionDate: futureDateStr,
					startTime: "09:30",
					endTime: "10:30",
				},
			},
		);
		assert(
			conflictRes.status === 409,
			"Overlapping trainer schedule returns 409 Conflict",
		);

		console.log("\n5. Testing Admin Grid & Member Schedule Roster Queries...");
		const adminGridRes = await fetchJson(
			baseUrl,
			"/api/v1/admin/classes/schedule",
			{
				token: adminToken,
			},
		);
		assert(
			adminGridRes.status === 200,
			"GET /api/v1/admin/classes/schedule returns 200 OK",
		);
		assert(
			adminGridRes.data.count >= 4,
			"Admin grid retrieves all scheduled session instances",
		);

		const memberScheduleRes = await fetchJson(
			baseUrl,
			`/api/v1/classes/schedule?date=${futureDateStr}`,
			{
				token: userToken,
			},
		);
		assert(
			memberScheduleRes.status === 200,
			"GET /api/v1/classes/schedule?date=... returns 200 OK for members",
		);

		console.log("\n6. Testing Scheduled Session Update...");
		const updateRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/schedule/${createdSessionId}`,
			{
				token: adminToken,
				method: "PATCH",
				body: {
					capacity: 25,
					locationAddress: "Studio B - Main Gym",
				},
			},
		);
		assert(
			updateRes.status === 200,
			"PATCH /api/v1/admin/classes/schedule/:id returns 200 OK",
		);
		assert(
			updateRes.data.session.capacity === 25,
			"Session capacity updated successfully",
		);

		console.log(
			"\n🎉 FEATURE-010 Class Scheduling (Sessions) Tests Passed!",
		);
	} finally {
		if (testClassId) {
			await ScheduledSession.deleteMany({ classId: testClassId });
			await ClassModel.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runFeature010Tests().catch((err) => {
	console.error("Class scheduling feature test failed:", err);
	process.exit(1);
});
