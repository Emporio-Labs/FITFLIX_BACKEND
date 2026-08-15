import { config } from "dotenv";
import mongoose from "mongoose";
import { expireMemberships } from "../src/services/membership-lifecycle.service";
import connectDB from "../src/utils/db";

config();

/**
 * Runs the membership expiry sweep once, on demand.
 *
 * Defaults to a DRY RUN — it reports what would lapse and writes nothing.
 * Pass --commit to actually expire. Use the dry run first on any database that
 * has never had a sweep: every already-lapsed membership is caught in one go,
 * and writing off unused value is not reversible.
 *
 *   bun run scripts/run-membership-expiry.ts            # dry run
 *   bun run scripts/run-membership-expiry.ts --commit   # for real
 */
async function main() {
	const commit = process.argv.includes("--commit");

	await connectDB();
	console.log(
		commit
			? "Running membership expiry — COMMITTING changes\n"
			: "Running membership expiry — DRY RUN (nothing will be written)\n",
	);

	const summary = await expireMemberships(new Date(), { dryRun: !commit });

	console.log("\n─────────────────────────────────────────");
	console.log(`  lapsed memberships found : ${summary.scanned}`);
	console.log(`  ${commit ? "expired" : "would expire"}          : ${summary.expired}`);
	console.log(`  credits written off      : ${summary.creditsWrittenOff}`);
	console.log(`  PT sessions written off  : ${summary.ptSessionsWrittenOff}`);
	console.log(`  errors                   : ${summary.errors}`);
	console.log("─────────────────────────────────────────");

	if (!commit && summary.scanned > 0) {
		console.log("\nRe-run with --commit to apply.");
	}
}

main()
	.then(async () => {
		await mongoose.connection.close();
		process.exit(0);
	})
	.catch(async (error) => {
		console.error("Expiry run failed:", error);
		await mongoose.connection.close();
		process.exit(1);
	});
