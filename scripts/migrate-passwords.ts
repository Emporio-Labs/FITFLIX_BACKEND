/**
 * migrate-passwords.ts
 *
 * Finds any user/admin/doctor/trainer accounts whose stored passwordHash is
 * NOT a valid bcrypt hash (i.e. still plaintext) and re-hashes it.
 *
 * Usage:
 *   bun run scripts/migrate-passwords.ts [--dry-run]
 *
 * --dry-run  Reports affected accounts without making any changes.
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import { hashPassword, isHashedPassword } from "../src/utils/password";

config();

const isDryRun = process.argv.slice(2).includes("--dry-run");

import Admin from "../src/models/Admin";

import Trainer from "../src/models/Trainer";
// Import models that have passwordHash fields (select:false — must use +passwordHash)
import User from "../src/models/User";

type ModelEntry = {
	name: string;
	model: mongoose.Model<any>;
};

const MODELS: ModelEntry[] = [
	{ name: "User", model: User as mongoose.Model<any> },
	{ name: "Admin", model: Admin as mongoose.Model<any> },
	{ name: "Trainer", model: Trainer as mongoose.Model<any> },
];

async function migrateModel({
	name,
	model,
}: ModelEntry): Promise<{ found: number; migrated: number }> {
	// select +passwordHash to override select:false
	const docs = await model.find({}).select("+passwordHash").lean();
	let found = 0;
	let migrated = 0;

	for (const doc of docs as any[]) {
		const raw = doc.passwordHash;
		if (typeof raw !== "string" || raw.trim() === "") continue;

		if (!isHashedPassword(raw)) {
			found++;
			console.log(`  [${name}] id=${String(doc._id)} has plaintext password`);

			if (!isDryRun) {
				const hashed = await hashPassword(raw);
				await model.updateOne(
					{ _id: doc._id },
					{ $set: { passwordHash: hashed } },
				);
				migrated++;
				console.log(`  [${name}] id=${String(doc._id)} → migrated to bcrypt`);
			}
		}
	}

	return { found, migrated };
}

async function main() {
	if (isDryRun) {
		console.log("DRY RUN — no changes will be written.\n");
	}

	await connectDB();

	let totalFound = 0;
	let totalMigrated = 0;

	for (const entry of MODELS) {
		console.log(`\nScanning ${entry.name}...`);
		const { found, migrated } = await migrateModel(entry);
		totalFound += found;
		totalMigrated += migrated;
	}

	console.log("\n--- Summary ---");
	console.log(`Plaintext passwords found : ${totalFound}`);
	if (!isDryRun) {
		console.log(`Successfully migrated     : ${totalMigrated}`);
	} else {
		console.log("(dry run — no changes made)");
	}

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
