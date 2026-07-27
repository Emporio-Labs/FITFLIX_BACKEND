import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { runZegocloudMigration } from "../scripts/migrate-zegocloud-rooms";
import { assert, startTestServer } from "./test-helpers";

async function runFeature008Tests() {
	console.log("=== Feature Test: FEATURE-008 Data Migration & Backfill ===");
	const { close } = await startTestServer();

	const db = mongoose.connection.db;
	if (!db) {
		throw new Error("MongoDB connection unavailable for migration test.");
	}

	const collection = db.collection("bookings");
	const testDoc1Id = randomUUID();
	const testDoc2Id = randomUUID();

	try {
		console.log("\n1. Inserting legacy Cal.com booking test records...");
		await collection.insertMany([
			{
				_id: testDoc1Id as any,
				bookingDate: new Date(),
				startTime: "09:00",
				endTime: "10:00",
				status: "Booked",
				calBookingId: "cal_test_abc123",
				meetingLink: "https://cal.com/meeting/abc123",
				createdAt: new Date(),
			},
			{
				_id: testDoc2Id as any,
				bookingDate: new Date(),
				startTime: "11:00",
				endTime: "12:00",
				status: "Booked",
				cal_booking_id: "cal_test_def456",
				meeting_link: "https://cal.com/meeting/def456",
				createdAt: new Date(),
			},
		]);

		console.log(
			"\n2. Testing Dry Run Mode (Validation & Execution Log without mutations)...",
		);
		const dryRunResult = await runZegocloudMigration(true);
		assert(
			dryRunResult.isDryRun === true,
			"Migration executed in Dry Run mode",
		);
		assert(
			dryRunResult.scanned >= 2,
			"Dry run scanned target legacy records",
		);
		assert(
			dryRunResult.migrated >= 2,
			"Dry run identified records for migration",
		);

		const unmutatedDoc1 = await collection.findOne({ _id: testDoc1Id });
		assert(
			unmutatedDoc1?.calBookingId === "cal_test_abc123",
			"Dry Run preserved legacy calBookingId in database without mutation",
		);
		assert(
			unmutatedDoc1?.roomId === undefined,
			"Dry Run did not mutate database state",
		);

		console.log(
			"\n3. Testing Live Apply Mode (Backfilling roomId & Dropping Cal.com fields)...",
		);
		const applyResult = await runZegocloudMigration(false);
		assert(applyResult.isDryRun === false, "Migration executed in Apply mode");
		assert(
			applyResult.migrated >= 2,
			"Apply mode migrated target booking records",
		);

		console.log("\n4. Verifying Data Integrity & Safety...");
		const migratedDoc1 = await collection.findOne({ _id: testDoc1Id });
		const migratedDoc2 = await collection.findOne({ _id: testDoc2Id });

		assert(
			Boolean(migratedDoc1?.roomId),
			"Record 1 successfully populated with ZEGOCLOUD roomId",
		);
		assert(
			migratedDoc1?.calBookingId === undefined,
			"Record 1 legacy calBookingId successfully unset",
		);
		assert(
			migratedDoc1?.meetingLink === undefined,
			"Record 1 legacy meetingLink successfully unset",
		);

		assert(
			Boolean(migratedDoc2?.roomId),
			"Record 2 successfully populated with ZEGOCLOUD roomId",
		);
		assert(
			migratedDoc2?.cal_booking_id === undefined,
			"Record 2 legacy cal_booking_id successfully unset",
		);

		assert(
			migratedDoc1?.status === "Booked" && migratedDoc2?.status === "Booked",
			"Data Safety: Status and booking metadata preserved (Zero records corrupted or orphaned)",
		);

		console.log("\n🎉 FEATURE-008 Data Migration & Backfill Tests Passed!");
	} finally {
		await collection.deleteMany({
			_id: { $in: [testDoc1Id as any, testDoc2Id as any] },
		});
		await close();
	}
}

runFeature008Tests().catch((err) => {
	console.error("Migration test failed:", err);
	process.exit(1);
});
