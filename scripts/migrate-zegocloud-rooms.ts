import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

export interface MigrationResult {
	scanned: number;
	migrated: number;
	skipped: number;
	errors: number;
	isDryRun: boolean;
	details: string[];
}

export async function runZegocloudMigration(
	isDryRun = true,
): Promise<MigrationResult> {
	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	const db = mongoose.connection.db;
	if (!db) {
		throw new Error("Failed to obtain database connection.");
	}

	const result: MigrationResult = {
		scanned: 0,
		migrated: 0,
		skipped: 0,
		errors: 0,
		isDryRun,
		details: [],
	};

	console.log("==================================================");
	console.log("🚀 FEATURE-008: ZEGOCLOUD Room Schema Migration & Backfill");
	console.log(
		`MODE: ${isDryRun ? "🔍 DRY RUN (Simulation - No DB Changes)" : "⚡ LIVE APPLY (Mutating Database)"}`,
	);
	console.log("==================================================\n");

	const targetCollections = [
		"bookings",
		"trainer_bookings",
		"nutritionist_bookings",
		"appointments",
	];

	for (const collName of targetCollections) {
		const collectionsList = await db
			.listCollections({ name: collName })
			.toArray();
		if (collectionsList.length === 0) {
			result.details.push(`Collection [${collName}] does not exist. Skipped.`);
			continue;
		}

		const collection = db.collection(collName);
		const cursor = collection.find({
			$or: [
				{ calBookingId: { $exists: true } },
				{ cal_booking_id: { $exists: true } },
				{ meetingLink: { $exists: true } },
				{ meeting_link: { $exists: true } },
				{ roomId: { $exists: false } },
				{ roomId: null },
			],
		});

		const records = await cursor.toArray();
		result.scanned += records.length;

		console.log(
			`▶ Collection [${collName}]: Found ${records.length} target record(s).`,
		);

		for (const doc of records) {
			try {
				const generatedRoomId =
					doc.roomId || doc.room_id || `zego_room_${doc._id || randomUUID()}`;
				const hasLegacyFields =
					doc.calBookingId !== undefined ||
					doc.cal_booking_id !== undefined ||
					doc.meetingLink !== undefined ||
					doc.meeting_link !== undefined;

				if (isDryRun) {
					result.migrated++;
					result.details.push(
						`[DRY RUN] ${collName}/${doc._id}: Assign roomId='${generatedRoomId}', unset legacy Cal.com fields.`,
					);
				} else {
					const updateDoc: any = {
						$set: {
							roomId: generatedRoomId,
							room_id: generatedRoomId,
						},
					};

					if (hasLegacyFields) {
						updateDoc.$unset = {
							calBookingId: "",
							cal_booking_id: "",
							meetingLink: "",
							meeting_link: "",
						};
					}

					await collection.updateOne({ _id: doc._id }, updateDoc);
					result.migrated++;
					result.details.push(
						`[APPLIED] ${collName}/${doc._id}: Backfilled roomId='${generatedRoomId}' & removed Cal.com fields.`,
					);
				}
			} catch (err: any) {
				result.errors++;
				result.details.push(
					`[ERROR] ${collName}/${doc._id}: ${err?.message || err}`,
				);
			}
		}
	}

	console.log("\n==================================================");
	console.log("📊 MIGRATION SUMMARY");
	console.log("==================================================");
	console.log(`- Execution Mode : ${isDryRun ? "DRY RUN" : "LIVE APPLY"}`);
	console.log(`- Scanned Records: ${result.scanned}`);
	console.log(`- Migrated/Target: ${result.migrated}`);
	console.log(`- Skipped Records: ${result.skipped}`);
	console.log(`- Errors         : ${result.errors}`);
	console.log("==================================================\n");

	return result;
}

// CLI Execution entrypoint
if (import.meta.main || process.argv[1]?.includes("migrate-zegocloud-rooms")) {
	const isApply =
		process.argv.includes("--apply") || process.argv.includes("--execute");
	const isDryRun = !isApply;

	runZegocloudMigration(isDryRun)
		.then(() => {
			console.log("✅ Migration process finished successfully.");
			process.exit(0);
		})
		.catch((err) => {
			console.error("❌ Migration failed:", err);
			process.exit(1);
		});
}
