import { config } from "dotenv";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import { PostMediaKind } from "../src/models/Enums";
import PostMedia from "../src/models/PostMedia";
import { getObjectBuffer } from "../src/utils/s3.service";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run scripts/backfill-post-media-dimensions.ts [--dry-run]");
	console.log("  --dry-run   Report what would change without writing");
};

const BATCH_SIZE = 500;

/**
 * community C2 fix: post.service.ts / moderation.service.ts now persist
 * width/height on every new image at upload time, but every PostMedia row
 * created before that change has width/height == null. Without a value the
 * feed falls back to a fixed 16:10 crop instead of the image's own ratio —
 * this script fills the gap for existing production posts.
 *
 * Reads each image object straight from S3 (server-side variants are
 * resized by width only, so the stored file's ratio already matches the
 * original — see config/community.ts imageVariants) and measures it with
 * Jimp, the same library image.service.ts uses at upload time.
 *
 * Safe to re-run: only rows with kind "image" and width == null are
 * touched, and a per-row failure is caught so one bad key doesn't abort
 * the sweep.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const needsFix = { kind: PostMediaKind.Image, width: null };
		const total = await PostMedia.countDocuments(needsFix);
		console.log(`${dryRun ? "[dry-run] " : ""}Found ${total} image row(s) missing dimensions\n`);

		let processed = 0;
		let fixed = 0;
		let failed = 0;

		const cursor = PostMedia.find(needsFix).batchSize(BATCH_SIZE).cursor();

		for await (const media of cursor) {
			processed++;
			try {
				const buffer = await getObjectBuffer(media.url);
				const image = await Jimp.read(buffer);
				const width = image.width;
				const height = image.height;

				if (!width || !height) {
					throw new Error("Jimp reported zero-size dimensions");
				}

				if (!dryRun) {
					await PostMedia.updateOne({ _id: media._id }, { $set: { width, height } });
				}
				fixed++;
			} catch (err) {
				failed++;
				console.error(`[backfill-post-media-dimensions] Failed for ${media._id} (${media.url}):`, err);
			}
		}

		console.log(
			`${dryRun ? "[dry-run] " : ""}Processed ${processed}: fixed=${fixed} failed=${failed}`,
		);

		if (dryRun) {
			console.log("\nNo changes written. Re-run without --dry-run to apply.");
		}
	} catch (error) {
		console.error("Backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

main();
