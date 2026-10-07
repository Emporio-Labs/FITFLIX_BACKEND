import { config } from "dotenv";
import mongoose from "mongoose";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import connectDB from "../src/utils/db";

config();

/**
 * FX-17 — backfill `branchIds` on branch-scoped staff.
 *
 * Under STAFF_RBAC_ENFORCE a staffer with no branches can act on nothing. This
 * one-off seeds each trainer / staff User from their existing single branch
 * (`locationId` / `homeLocationId`) so they keep working the moment the flag is
 * turned on. Idempotent: records that already have `branchIds` are left alone.
 *
 *   bun run scripts/assign-staff-branches.ts            # apply
 *   bun run scripts/assign-staff-branches.ts --dry-run  # report only
 */

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	try {
		await connectDB();

		// Trainers: branchIds empty, but a legacy single locationId is set.
		const trainers = await Trainer.find({
			$and: [
				{ $or: [{ branchIds: { $exists: false } }, { branchIds: { $size: 0 } }] },
				{ locationId: { $ne: null } },
			],
		}).select("_id trainerName locationId");

		// Staff Users (staffRole set): branchIds empty, homeLocationId set.
		const staffUsers = await User.find({
			staffRole: { $ne: null },
			$and: [
				{ $or: [{ branchIds: { $exists: false } }, { branchIds: { $size: 0 } }] },
				{ homeLocationId: { $ne: null } },
			],
		}).select("_id username staffRole homeLocationId");

		console.log(
			`Trainers to backfill: ${trainers.length}; staff Users to backfill: ${staffUsers.length}${dryRun ? " (dry run)" : ""}`,
		);

		for (const t of trainers) {
			const branchIds = [t.locationId];
			console.log(`  trainer ${t._id} (${t.trainerName}) → [${t.locationId}]`);
			if (!dryRun) {
				await Trainer.updateOne({ _id: t._id }, { $set: { branchIds } });
			}
		}

		for (const u of staffUsers) {
			const branchIds = [u.homeLocationId];
			console.log(
				`  user ${u._id} (${u.username}, ${u.staffRole}) → [${u.homeLocationId}]`,
			);
			if (!dryRun) {
				await User.updateOne({ _id: u._id }, { $set: { branchIds } });
			}
		}

		console.log(dryRun ? "Dry run complete — no changes written." : "Backfill complete.");
	} catch (error) {
		console.error("Failed to backfill staff branches:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
