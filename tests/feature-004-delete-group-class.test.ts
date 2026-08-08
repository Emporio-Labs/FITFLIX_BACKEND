import Class from "../src/models/Class";
import Booking from "../src/models/Bookings";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runDeleteTests() {
	console.log("=== Feature Test: FEATURE-004 Delete Group Class ===");
	const { baseUrl, close } = await startTestServer();
	let hardClassId: string | null = null;
	let softClassId: string | null = null;

	try {
		// --- Test Case 1: Hard Delete (No bookings/history) ---
		console.log("\nTesting Class Hard Delete (No bookings/history)...");
		const setupClass1 = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Class to be Hard Deleted",
				creditCost: 3,
				status: "ACTIVE",
			},
		});
		hardClassId = setupClass1.data.class._id;

		const deleteRes1 = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${hardClassId}`,
			{
				token: adminToken,
				method: "DELETE",
			},
		);

		assert(deleteRes1.status === 200, "Delete class returns 200");
		assert(
			deleteRes1.data.message === "Class deleted successfully",
			"Message says Class deleted successfully"
		);

		// Verify it was removed from the database
		const dbClass1 = await Class.findById(hardClassId);
		assert(dbClass1 === null, "Class was permanently removed from database");
		hardClassId = null; // Cleaned up


		// --- Test Case 2: Soft Delete (With bookings/history) ---
		console.log("\nTesting Class Soft Delete (With bookings)...");
		const setupClass2 = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Class to be Soft Deleted",
				creditCost: 3,
				status: "ACTIVE",
			},
		});
		softClassId = setupClass2.data.class._id;

		// Create a mock booking referencing this class
		await Booking.create({
			bookingDate: new Date(),
			startTime: "09:00",
			endTime: "10:00",
			status: "Booked",
			user: "000000000000000000000001", // Dummy ObjectId
			classId: softClassId,
			creditCostSnapshot: 3,
		});

		const deleteRes2 = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${softClassId}`,
			{
				token: adminToken,
				method: "DELETE",
			},
		);

		assert(deleteRes2.status === 200, "Retire class returns 200");
		assert(
			deleteRes2.data.message === "Class retired",
			"Message says Class retired"
		);

		// Verify it remains in database with status INACTIVE
		const dbClass2 = await Class.findById(softClassId);
		assert(dbClass2 !== null, "Class document still exists in database");
		assert(
			dbClass2.status === "INACTIVE",
			"Class status was set to INACTIVE in database"
		);

		console.log("\n🎉 FEATURE-004 Delete Class Tests Passed!");
	} finally {
		if (hardClassId) {
			await Class.findByIdAndDelete(hardClassId);
		}
		if (softClassId) {
			await Booking.deleteMany({ classId: softClassId });
			await Class.findByIdAndDelete(softClassId);
		}
		await close();
	}
}

runDeleteTests().catch((err) => {
	console.error("Delete class test failed:", err);
	process.exit(1);
});

