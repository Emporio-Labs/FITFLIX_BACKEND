import { config } from "dotenv";
import mongoose from "mongoose";
import { ExpertType, SlotResourceType } from "../src/models/Enums";
import Slot from "../src/models/Slots";
import connectDB from "../src/utils/db";
import { calculateDurationMinutes } from "../src/utils/time.util";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run backfill:slot-resource-type [--dry-run]");
	console.log("  --dry-run   Show what would change without writing updates");
};

async function main() {
	const showHelp = hasFlag("--help") || hasFlag("-h");
	if (showHelp) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const allSlots = await Slot.find({
			$or: [
				{ resourceType: { $exists: false } },
				{ resourceType: null },
				{ durationMinutes: { $exists: false } },
				{ durationMinutes: null },
			],
		});

		console.log(`Slots needing resourceType/durationMinutes migration: ${allSlots.length}`);

		if (allSlots.length === 0) {
			console.log("No migration needed. All slots have resourceType and durationMinutes.");
			return;
		}

		let updatedCount = 0;
		for (const slot of allSlots) {
			let resourceType = slot.resourceType;
			if (!resourceType) {
				if (slot.expertType === ExpertType.SportsScientist) {
					resourceType = SlotResourceType.SPORTS_SCIENTIST;
				} else {
					resourceType = SlotResourceType.NUTRITIONIST;
				}
			}

			const durationMinutes =
				slot.durationMinutes ??
				(slot.startTime && slot.endTime
					? calculateDurationMinutes(slot.startTime, slot.endTime)
					: 60);

			if (dryRun) {
				console.log(
					`[DRY RUN] Would update slot ${slot._id}: resourceType=${resourceType}, durationMinutes=${durationMinutes}`,
				);
			} else {
				slot.resourceType = resourceType;
				slot.durationMinutes = durationMinutes;
				await slot.save();
				updatedCount++;
			}
		}

		if (dryRun) {
			console.log(`Dry run complete. Checked ${allSlots.length} documents.`);
		} else {
			console.log(`Migration complete. Updated ${updatedCount} slots.`);
		}
	} catch (error) {
		console.error("Slot resourceType backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
