import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import connectDB from "../src/utils/db";
import {
	parseAndValidateMigrationWorkbook,
	executeMigrationBatch,
} from "../src/utils/member-migration-excel";

config();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filePath = args.find((a) => !a.startsWith("--"));

async function main() {
	if (!filePath) {
		console.log("Usage: bun run scripts/migrate-historical-members.ts <path-to-file.xlsx> [--dry-run]");
		process.exit(1);
	}

	const resolvedPath = path.resolve(filePath);
	if (!fs.existsSync(resolvedPath)) {
		console.error(`File not found at: ${resolvedPath}`);
		process.exit(1);
	}

	console.log(`Connecting to database...`);
	await connectDB();

	console.log(`Reading Excel file: ${resolvedPath}`);
	const buffer = fs.readFileSync(resolvedPath);

	console.log(`Parsing and validating sheets...`);
	const validation = await parseAndValidateMigrationWorkbook(buffer);

	console.log("\n================ VALIDATION SUMMARY ================");
	console.log(`Valid: ${validation.valid ? "YES" : "NO"}`);
	console.log(`Total Members: ${validation.summary.totalMembers}`);
	console.log(`Total Past Sessions: ${validation.summary.totalSessions}`);
	console.log(`Total Credits Granted: ${validation.summary.totalCreditsIncluded}`);
	console.log(`Total Credits Deducted: ${validation.summary.totalCreditsDeducted}`);
	console.log(`Net Remaining Credits: ${validation.summary.netRemainingCredits}`);
	console.log(`Existing Users (Linked): ${validation.summary.existingUsersCount}`);
	console.log(`New Users to Create: ${validation.summary.newUsersCount}`);

	if (validation.warnings.length > 0) {
		console.log("\nWarnings:");
		for (const w of validation.warnings) {
			console.log(` - [${w.sheet}] ${w.message}`);
		}
	}

	if (!validation.valid || validation.errors.length > 0) {
		console.error("\nValidation Errors:");
		for (const e of validation.errors) {
			console.error(` - [${e.sheet} Row ${e.row}] ${e.field ? `${e.field}: ` : ""}${e.message}`);
		}
		console.error("\nMigration aborted due to errors.");
		process.exit(1);
	}

	if (dryRun) {
		console.log("\n[DRY RUN] No database writes were performed. File is 100% valid and ready to import.");
		process.exit(0);
	}

	console.log("\nExecuting migration in database...");
	const result = await executeMigrationBatch(validation, undefined, "script");

	console.log("\n================ EXECUTION RESULT ================");
	console.log(`Successfully imported memberships: ${result.summary.importedMembers}`);
	console.log(`Created users: ${result.summary.createdUsers}`);
	console.log(`Linked existing users: ${result.summary.linkedUsers}`);
	console.log(`Total sessions recorded: ${result.summary.totalSessionsRecorded}`);
	console.log(`Total credits granted: ${result.summary.totalCreditsGranted}`);
	console.log(`Total credits deducted: ${result.summary.totalCreditsDeducted}`);

	if (result.errors.length > 0) {
		console.error("\nExecution errors:");
		for (const err of result.errors) {
			console.error(` - ${err}`);
		}
	}

	console.log("\nDone!");
	process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
	console.error("Migration error:", err);
	process.exit(1);
});
