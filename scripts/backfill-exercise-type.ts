import { config } from "dotenv";
import mongoose from "mongoose";
import { ExerciseType } from "../src/models/Enums";
import Exercise from "../src/models/Exercise";
import connectDB from "../src/utils/db";
import { looksLikeCardio } from "../src/utils/exercise-type";

config();

// Marks existing cardio exercises (treadmill, StairMaster, bikes, rowers…) as
// exerciseType "cardio" so every client logs them by time. Only rows that have
// no exerciseType yet are touched: a type a trainer set by hand is never
// overwritten.
//
//   bun run scripts/backfill-exercise-type.ts           # dry run, prints matches
//   bun run scripts/backfill-exercise-type.ts --apply   # writes
const APPLY = process.argv.includes("--apply");

async function main() {
	await connectDB();

	const rows = await Exercise.find({ exerciseType: { $exists: false } })
		.select({ _id: 1, name: 1 })
		.lean();
	console.log(`Found ${rows.length} exercises without an exerciseType`);

	const cardio = rows.filter((r) => looksLikeCardio(r.name));
	const cardioIds = new Set(cardio.map((r) => r._id.toString()));
	const strengthIds = rows
		.filter((r) => !cardioIds.has(r._id.toString()))
		.map((r) => r._id);

	console.log(`Cardio (${cardio.length}):`);
	for (const r of cardio) console.log(`  - ${r.name}`);
	console.log(`Strength: ${strengthIds.length}`);

	if (!APPLY) {
		console.log("Dry run — re-run with --apply to write.");
		await mongoose.disconnect();
		return;
	}

	const [c, s] = await Promise.all([
		Exercise.updateMany(
			{ _id: { $in: cardio.map((r) => r._id) }, exerciseType: { $exists: false } },
			{ $set: { exerciseType: ExerciseType.Cardio } },
		),
		Exercise.updateMany(
			{ _id: { $in: strengthIds }, exerciseType: { $exists: false } },
			{ $set: { exerciseType: ExerciseType.Strength } },
		),
	]);
	console.log(
		`Backfill complete: ${c.modifiedCount} cardio, ${s.modifiedCount} strength`,
	);
	await mongoose.disconnect();
}

main().catch((error) => {
	console.error("Backfill failed:", error);
	process.exit(1);
});
