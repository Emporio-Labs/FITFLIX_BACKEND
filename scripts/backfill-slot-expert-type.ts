import { config } from "dotenv";
import mongoose from "mongoose";
import { ExpertType } from "../src/models/Enums";
import Slot from "../src/models/Slots";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run backfill:slot-expert-type [--dry-run]");
	console.log("  --dry-run   Show what would change without writing updates");
};

// Added 2026-08-26 alongside the new `expertType` field on Slot. Every slot
// created before this field existed served the nutritionist booking flow —
// it was the only consumer of /slots/available — so backfilling those rows
// to "nutritionist" preserves exactly what /slots/available already returned
// for them. Only rows missing the field are touched; a slot an admin already
// created with an explicit expertType (this migration ran once already, or a
// sports-scientist slot created after the schema change shipped) is left
// alone.
async function main() {
	const showHelp = hasFlag("--help") || hasFlag("-h");
	if (showHelp) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const filter = {
			$or: [{ expertType: { $exists: false } }, { expertType: null }],
		};

		type SlotShape = {
			_id: mongoose.Types.ObjectId;
			startTime?: string;
			endTime?: string;
			isDaily?: boolean;
		};

		const slots = (await Slot.find(filter)
			.select("_id startTime endTime isDaily")
			.lean()) as SlotShape[];

		console.log(`Slots missing expertType: ${slots.length}`);
		for (const slot of slots) {
			console.log(
				`  - ${slot._id} (${slot.isDaily ? "daily" : "dated"} ${slot.startTime ?? "?"}-${slot.endTime ?? "?"})`,
			);
		}

		if (slots.length === 0) {
			console.log("No migration needed.");
			return;
		}

		if (dryRun) {
			console.log("Dry run complete. No database changes were applied.");
			return;
		}

		const result = await Slot.updateMany(filter, {
			$set: { expertType: ExpertType.Nutritionist },
		});

		console.log("Migration complete.");
		console.log(`Matched documents: ${result.matchedCount}`);
		console.log(`Modified documents: ${result.modifiedCount}`);
	} catch (error) {
		console.error("Slot expertType backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
