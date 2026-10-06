import { config } from "dotenv";
import mongoose from "mongoose";
import { UnifiedBookingStatus } from "../src/models/Enums";
import UnifiedBooking from "../src/models/UnifiedBooking";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run migrate:slot-index [--dry-run]");
	console.log(
		"  --dry-run   Show what would change without writing updates / rebuilding indexes",
	);
};

// Added 2026-10-06 for FX-03 (no double bookings under concurrency).
//
// The double-booking guard for 1-on-1 expert sessions is the partial UNIQUE
// index on {expertId, bookingDate, startTime}. Its original partialFilter used
// `status: { $in: [...] }` and `expertId: { $ne: null }` — operators MongoDB
// rejects in a partial index at build time, so (with the default autoIndex
// swallowing the failure) the index very likely never existed and nothing
// structurally stopped two people booking the same slot.
//
// UnifiedBooking.ts now derives a `slotHold` boolean from status via hooks and
// filters the index on the equality `{ slotHold: true }`, which every MongoDB
// version accepts. This script makes an already-running database consistent:
//   1. Backfill slotHold on rows the hooks would now set.
//   2. syncIndexes() to drop the stale/broken definition and build the new one.
// Safe to run repeatedly.
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const activeFilter = {
			status: {
				$in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED],
			},
			expertId: { $ne: null },
			slotHold: { $ne: true },
		};
		const staleFilter = {
			slotHold: true,
			$or: [
				{
					status: {
						$nin: [
							UnifiedBookingStatus.PENDING,
							UnifiedBookingStatus.CONFIRMED,
						],
					},
				},
				{ expertId: null },
			],
		};

		const toSet = await UnifiedBooking.countDocuments(activeFilter);
		const toUnset = await UnifiedBooking.countDocuments(staleFilter);
		console.log(
			`Active bookings missing slotHold: ${toSet}  |  stale slotHold to clear: ${toUnset}`,
		);

		if (dryRun) {
			const existing = await UnifiedBooking.collection.indexes();
			console.log("Current indexes:");
			for (const i of existing) {
				console.log(
					`  ${i.name} ${JSON.stringify(i.key)} unique=${!!i.unique} pfe=${JSON.stringify(i.partialFilterExpression ?? null)}`,
				);
			}
			console.log("Dry run complete. No changes were applied.");
			return;
		}

		// Write directly through the collection so the backfill does not depend on
		// the pre-update hook (which only reacts to status changes).
		const setRes = await UnifiedBooking.collection.updateMany(activeFilter, {
			$set: { slotHold: true },
		});
		const unsetRes = await UnifiedBooking.collection.updateMany(staleFilter, {
			$unset: { slotHold: "" },
		});
		console.log(
			`Backfill: set slotHold on ${setRes.modifiedCount}, cleared ${unsetRes.modifiedCount}.`,
		);

		console.log("Reconciling indexes (syncIndexes)...");
		const dropped = await UnifiedBooking.syncIndexes();
		console.log(
			`syncIndexes complete. Dropped: ${JSON.stringify(dropped)}`,
		);

		const finalIndexes = await UnifiedBooking.collection.indexes();
		const slotIndex = finalIndexes.find(
			(i) =>
				i.key &&
				i.key.expertId === 1 &&
				i.key.bookingDate === 1 &&
				i.key.startTime === 1,
		);
		if (slotIndex?.unique && slotIndex.partialFilterExpression?.slotHold === true) {
			console.log(
				`✅ Corrected unique index present: ${slotIndex.name} pfe=${JSON.stringify(slotIndex.partialFilterExpression)}`,
			);
		} else {
			console.error(
				"❌ Corrected unique index NOT found after syncIndexes. Indexes:",
			);
			for (const i of finalIndexes) {
				console.error(
					`  ${i.name} ${JSON.stringify(i.key)} unique=${!!i.unique} pfe=${JSON.stringify(i.partialFilterExpression ?? null)}`,
				);
			}
			process.exitCode = 1;
		}
	} catch (error) {
		console.error("slot-index migration failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
