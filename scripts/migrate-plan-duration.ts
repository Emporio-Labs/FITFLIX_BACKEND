import { config } from "dotenv";
import mongoose from "mongoose";
import MembershipPlan from "../src/models/MembershipPlan";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run migrate:plan-duration [--dry-run]");
	console.log("  --dry-run   Show what would change without writing updates");
};

// The schema used to default durationDays to 30, which meant every plan carried
// that value whether or not an admin ever set it — shadowing durationMonths on
// every read site. Only unset plans still holding exactly that leftover default;
// any deliberately-seeded durationDays (e.g. 84 for a 12-week pack) is untouched.
const LEGACY_DEFAULT_DAYS = 30;

async function main() {
	const showHelp = hasFlag("--help") || hasFlag("-h");
	if (showHelp) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		type MembershipPlanShape = {
			_id: mongoose.Types.ObjectId;
			name?: string;
			durationDays?: number | null;
			durationMonths?: number | null;
		};

		const plans = (await MembershipPlan.find({ durationDays: LEGACY_DEFAULT_DAYS })
			.select("_id name durationDays durationMonths")
			.lean()) as MembershipPlanShape[];

		console.log(`Plans with durationDays === ${LEGACY_DEFAULT_DAYS}: ${plans.length}`);
		for (const plan of plans) {
			console.log(
				`  - ${plan.name ?? plan._id} (durationMonths=${plan.durationMonths ?? "unset"})`,
			);
		}

		if (plans.length === 0) {
			console.log("No migration needed.");
			return;
		}

		if (dryRun) {
			console.log("Dry run complete. No database changes were applied.");
			return;
		}

		// Mongoose's bulkWrite typings don't model $unset cleanly against the schema's
		// inferred document type; the shape itself is standard MongoDB bulk-write syntax.
		const operations: mongoose.AnyBulkWriteOperation[] = plans.map((plan) => ({
			updateOne: {
				filter: { _id: plan._id },
				update: { $unset: { durationDays: "" } },
			},
		}));

		const result = await MembershipPlan.bulkWrite(operations, { ordered: false });

		console.log("Migration complete.");
		console.log(`Matched documents: ${result.matchedCount}`);
		console.log(`Modified documents: ${result.modifiedCount}`);
	} catch (error) {
		console.error("Plan duration migration failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
