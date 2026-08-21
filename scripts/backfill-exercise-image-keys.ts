import { config } from "dotenv";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise";
import connectDB from "../src/utils/db";

config();

// Mirrors the key layout written by scripts/upload-exercise-images.ts:
//   exercises/free-exercise-db/<Exercise_Name>/<n>.jpg
const KEY_PREFIX = "exercises/free-exercise-db";

// jsDelivr URLs look like:
//   https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/3_4_Sit-Up/0.jpg
// The S3 key is everything after that trailing "/exercises/", re-prefixed.
const toKey = (url: string): string | null => {
	const marker = "/exercises/";
	const idx = url.lastIndexOf(marker);
	if (idx === -1) return null;
	const relative = url.slice(idx + marker.length);
	if (!relative) return null;
	return `${KEY_PREFIX}/${relative}`;
};

async function main() {
	await connectDB();

	const rows = await Exercise.find({
		imageUrls: { $exists: true, $ne: [] },
	})
		.select({ _id: 1, name: 1, imageUrls: 1 })
		.lean();

	console.log(`Found ${rows.length} exercises with imageUrls`);

	const ops: any[] = [];
	let skipped = 0;
	for (const row of rows) {
		const urls: string[] = Array.isArray(row.imageUrls) ? row.imageUrls : [];
		const keys = urls
			.map(toKey)
			.filter((k): k is string => Boolean(k));
		if (keys.length === 0) {
			skipped++;
			continue;
		}
		ops.push({
			updateOne: {
				filter: { _id: row._id },
				update: { $set: { imageKeys: keys } },
			},
		});
	}

	if (ops.length === 0) {
		console.log("Nothing to backfill.");
		await mongoose.disconnect();
		return;
	}

	console.log(`Writing imageKeys for ${ops.length} exercises (skipped ${skipped})...`);
	const result = await Exercise.bulkWrite(ops);
	console.log(`Backfill complete: ${result.modifiedCount} updated`);

	const sample = await Exercise.findOne({ name: "3/4 Sit-Up" })
		.select({ name: 1, imageKeys: 1 })
		.lean();
	console.log("Sample:", JSON.stringify(sample));

	await mongoose.disconnect();
	console.log("Done.");
}

main().catch((error) => {
	console.error("Backfill failed:", error);
	process.exit(1);
});
