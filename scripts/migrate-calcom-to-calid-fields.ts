import { config } from "dotenv";
import mongoose from "mongoose";
import ExpertAppointment from "../src/models/ExpertAppointment";
import connectDB from "../src/utils/db";

type LegacyCalComAppointment = {
	_id: mongoose.Types.ObjectId;
	calIdBookingId?: string | null;
	calIdEventId?: string | null;
	calIdEventTypeId?: string | null;
	calComBookingId?: string | null;
	calEventId?: string | null;
	calEventTypeId?: string | null;
};

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

async function main() {
	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();
		console.log("Connected to database successfully.");

		// Query plain objects containing legacy Cal.com fields
		const appointments = await ExpertAppointment.find({
			$or: [
				{ calComBookingId: { $exists: true, $ne: null } },
				{ calEventId: { $exists: true, $ne: null } },
				{ calEventTypeId: { $exists: true, $ne: null } },
			],
		}).lean();

		let migratedCount = 0;

		console.log(
			`Found ${appointments.length} appointments with legacy Cal.com fields.`,
		);

		for (const app of appointments as LegacyCalComAppointment[]) {
			const rawApp = app;
			const calIdBookingId = rawApp.calIdBookingId || rawApp.calComBookingId;
			const calIdEventId = rawApp.calIdEventId || rawApp.calEventId;
			const calIdEventTypeId = rawApp.calIdEventTypeId || rawApp.calEventTypeId;

			console.log(
				`Migrating Appointment ${app._id}: ` +
					`calComBookingId="${rawApp.calComBookingId}" -> calIdBookingId="${calIdBookingId}", ` +
					`calEventId="${rawApp.calEventId}" -> calIdEventId="${calIdEventId}", ` +
					`calEventTypeId="${rawApp.calEventTypeId}" -> calIdEventTypeId="${calIdEventTypeId}"`,
			);

			if (!dryRun) {
				await ExpertAppointment.findByIdAndUpdate(
					app._id,
					{
						$set: {
							calIdBookingId,
							calIdEventId,
							calIdEventTypeId,
						},
						$unset: {
							calComBookingId: "",
							calEventId: "",
							calEventTypeId: "",
						},
					},
					{ strict: false },
				);
			}

			migratedCount++;
		}

		console.log(
			`\n${dryRun ? "[DRY RUN] " : ""}Migration complete: ${migratedCount} appointments processed.`,
		);
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}

	await mongoose.disconnect();
	process.exit(0);
}

main();
