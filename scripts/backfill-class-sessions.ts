import { config } from "dotenv";
import mongoose from "mongoose";
import { syncSessionsForClass } from "../src/controllers/class.controller";
import Class from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import connectDB from "../src/utils/db";
import { normalizeDeliveryType } from "../src/utils/delivery-type";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run backfill:class-sessions [--dry-run]");
	console.log("  --dry-run   Report what would change without writing");
};

/**
 * Repairs two kinds of drift for published classes:
 *
 *  1. Sessions whose `deliveryType` disagrees with their parent class's `mode`
 *     (e.g. an online class holding OFFLINE sessions, which the user app then
 *     files under the wrong delivery tab).
 *  2. Recurring classes that advertise a schedule but have no future sessions
 *     materialized, so nothing reaches the member feed.
 *
 * Safe to re-run: session regeneration preserves any session that already has
 * bookings.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const classes = await Class.find({
			status: "ACTIVE",
			isPublished: { $ne: false },
		}).sort({ name: 1 });

		console.log(
			`${dryRun ? "[dry-run] " : ""}Backfilling ${classes.length} active published class(es)\n`,
		);

		const todayStart = new Date();
		todayStart.setUTCHours(0, 0, 0, 0);

		let totalRepaired = 0;
		let totalCreated = 0;
		let totalDeleted = 0;
		let totalPreserved = 0;
		const skipped: string[] = [];

		for (const classDoc of classes) {
			const expected = normalizeDeliveryType(classDoc.mode);

			// 1. Realign deliveryType on every existing session for this class.
			const mismatched = await ScheduledSession.countDocuments({
				classId: classDoc._id,
				deliveryType: { $ne: expected },
			});

			if (mismatched > 0 && !dryRun) {
				await ScheduledSession.updateMany(
					{ classId: classDoc._id, deliveryType: { $ne: expected } },
					{ $set: { deliveryType: expected } },
				);
			}
			totalRepaired += mismatched;

			// 2. Regenerate future sessions from the class's recurrence.
			const summary = await syncSessionsForClass(classDoc, { dryRun });

			const futureCount = await ScheduledSession.countDocuments({
				classId: classDoc._id,
				sessionDate: { $gte: todayStart },
			});

			totalCreated += summary.created;
			totalDeleted += summary.deleted;
			totalPreserved += summary.preserved;

			const parts = [
				`mode=${classDoc.mode}`,
				`deliveryType=${expected}`,
				`repaired=${mismatched}`,
				`created=${summary.created}`,
				`deleted=${summary.deleted}`,
				`preserved=${summary.preserved}`,
				`futureSessions=${futureCount}`,
			];
			if (summary.skipped) {
				parts.push(`SKIPPED (${summary.reason})`);
				skipped.push(`${classDoc.name}: ${summary.reason}`);
			}

			console.log(`- ${classDoc.name}\n    ${parts.join("  ")}`);
		}

		console.log(
			`\n${dryRun ? "[dry-run] " : ""}Totals: repaired=${totalRepaired} created=${totalCreated} deleted=${totalDeleted} preserved=${totalPreserved}`,
		);

		if (skipped.length > 0) {
			console.log("\nClasses with no sessions generated:");
			for (const line of skipped) console.log(`  - ${line}`);
			console.log(
				"  (these have no parseable schedule — set a recurrence in the admin portal)",
			);
		}

		if (dryRun) {
			console.log("\nNo changes written. Re-run without --dry-run to apply.");
		}
	} catch (error) {
		console.error("Backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

main();
