import { config } from "dotenv";
import mongoose from "mongoose";
import Class from "../src/models/Class";
import CreditTransaction from "../src/models/CreditTransaction";
import GymVisit from "../src/models/GymVisit";
import Location, { DEFAULT_LOCATION_SETTINGS } from "../src/models/Location";
import Membership from "../src/models/Membership";
import Slot from "../src/models/Slots";
import Trainer from "../src/models/Trainer";
import UnifiedBooking from "../src/models/UnifiedBooking";
import User from "../src/models/User";
import connectDB from "../src/utils/db";

config();

/**
 * Seeds the first physical branch and backfills locationId onto existing
 * records so nothing is left unscoped when a second branch appears.
 *
 * Idempotent: re-running updates the branch in place (matched on `code`) and
 * only stamps documents that are still missing a locationId.
 *
 * Usage:
 *   bun run scripts/seed-locations.ts
 *   bun run scripts/seed-locations.ts --clean-trainers   (also removes test roster entries)
 */

const PRIMARY_LOCATION = {
	name: "Fitflix Sainikpuri",
	code: "sainikpuri",
	address: {
		line1: "Fitflix Wellness Club",
		line2: "Sainikpuri",
		city: "Hyderabad",
		state: "Telangana",
		pincode: "500094",
		country: "India",
	},
	phone: process.env.SUPPORT_PHONE || "+91 91234 56789",
	email: "sainikpuri@fitflix.in",
	timezone: "Asia/Kolkata",
	isActive: true,
};

// Roster entries that are obviously test data leaking into the member app.
const TEST_TRAINER_PATTERNS = [
	/^e2e$/i,
	/^sambar$/i,
	/^hh\s*ss$/i,
	/^mashenmi$/i,
	/^test\b/i,
];

async function seedLocations() {
	const cleanTrainers = process.argv.includes("--clean-trainers");

	await connectDB();
	console.log("Connected. Seeding locations…\n");

	// 1. Upsert the primary branch.
	const location = await Location.findOneAndUpdate(
		{ code: PRIMARY_LOCATION.code },
		{
			$set: PRIMARY_LOCATION,
			$setOnInsert: { settings: DEFAULT_LOCATION_SETTINGS },
		},
		{ new: true, upsert: true, setDefaultsOnInsert: true },
	);

	if (!location) {
		throw new Error("Failed to upsert the primary location");
	}

	console.log(`✔ Location "${location.name}" (${location.code})`);
	console.log(`  id:       ${location._id}`);
	console.log(`  timezone: ${location.timezone}`);
	console.log(
		`  settings: cancel ${location.settings?.cancellationWindowHours}h · pause cap ${location.settings?.pauseMaxDaysPerTerm}d · tax ${location.settings?.taxRatePercent}%\n`,
	);

	const locationId = location._id;

	// 2. Backfill locationId on operational records that predate locations.
	// Only touches documents where it is unset, so re-runs are safe and a
	// second branch's records are never reassigned.
	const unset = { $in: [null, undefined] };

	const targets: Array<{
		label: string;
		model: mongoose.Model<any>;
		field: string;
	}> = [
		{ label: "Users (home club)", model: User, field: "homeLocationId" },
		{ label: "Trainers", model: Trainer, field: "locationId" },
		{ label: "Gym visits", model: GymVisit, field: "locationId" },
		{ label: "Bookings", model: UnifiedBooking, field: "locationId" },
		{ label: "Slots", model: Slot, field: "locationId" },
		{ label: "Classes", model: Class, field: "locationId" },
		{ label: "Memberships", model: Membership, field: "locationId" },
		{
			label: "Credit transactions",
			model: CreditTransaction,
			field: "locationId",
		},
	];

	for (const target of targets) {
		const result = await target.model.updateMany(
			{ [target.field]: unset },
			{ $set: { [target.field]: locationId } },
		);
		console.log(
			`✔ ${target.label.padEnd(22)} stamped ${result.modifiedCount} record(s)`,
		);
	}

	// 3. Optionally clear obvious test trainers out of the public roster.
	if (cleanTrainers) {
		console.log("\nCleaning test trainer roster entries…");
		const trainers = await Trainer.find({}).select("trainerName isActive");
		let deactivated = 0;

		for (const trainer of trainers) {
			const name = String(trainer.trainerName ?? "").trim();
			if (TEST_TRAINER_PATTERNS.some((pattern) => pattern.test(name))) {
				// Deactivate rather than delete — trainers are referenced by
				// historical bookings, and removing them would orphan that history.
				await Trainer.updateOne(
					{ _id: trainer._id },
					{ $set: { isActive: false } },
				);
				deactivated += 1;
				console.log(`  · deactivated "${name}"`);
			}
		}

		console.log(`✔ Deactivated ${deactivated} test trainer(s)`);
	} else {
		console.log(
			"\n(Skipping trainer cleanup — pass --clean-trainers to deactivate test roster entries)",
		);
	}

	const activeCount = await Location.countDocuments({ isActive: true });
	console.log(
		`\nDone. ${activeCount} active location(s). With exactly one, the API resolves it automatically and no client needs to send locationId.`,
	);
}

seedLocations()
	.then(async () => {
		await mongoose.connection.close();
		process.exit(0);
	})
	.catch(async (error) => {
		console.error("Location seed failed:", error);
		await mongoose.connection.close();
		process.exit(1);
	});
