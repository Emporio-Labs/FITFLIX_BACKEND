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

// Import models that have passwordHash fields (select:false — must use +passwordHash)
import User from "../src/models/User";
import Admin from "../src/models/Admin";
import Doctor from "../src/models/Doctor";
import Trainer from "../src/models/Trainer";

type ModelEntry = {
	name: string;
	model: mongoose.Model<mongoose.Document & { passwordHash?: string }>;
};

const MODELS: ModelEntry[] = [
	{ name: "User", model: User as ModelEntry["model"] },
	{ name: "Admin", model: Admin as ModelEntry["model"] },
	{ name: "Doctor", model: Doctor as ModelEntry["model"] },
	{ name: "Trainer", model: Trainer as ModelEntry["model"] },
];

async function migrateModel({ name, model }: ModelEntry): Promise<{ found: number; migrated: number }> {
	// select +passwordHash to override select:false
	const docs = await model.find({}).select("+passwordHash").lean();
	let found = 0;
	let migrated = 0;

	for (const doc of docs) {
		const raw = (doc as Record<string, unknown>).passwordHash;
		if (typeof raw !== "string" || raw.trim() === "") continue;

		if (!isHashedPassword(raw)) {
			found++;
			console.log(`  [${name}] id=${String((doc as Record<string, unknown>)._id)} has plaintext password`);

			if (!isDryRun) {
				const hashed = await hashPassword(raw);
				await model.updateOne({ _id: (doc as Record<string, unknown>)._id }, { $set: { passwordHash: hashed } });
				migrated++;
				console.log(`  [${name}] id=${String((doc as Record<string, unknown>)._id)} → migrated to bcrypt`);
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
