import { config } from "dotenv";
import { headS3Object, uploadToS3 } from "../src/utils/s3.service";

config();

const SOURCE_JSON =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json";
const IMAGE_CDN =
	"https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises";
const KEY_PREFIX = "exercises/free-exercise-db";
const CONCURRENCY = 10;

interface SourceExercise {
	id: string;
	name: string;
	images: string[];
}

interface Job {
	sourcePath: string;
	key: string;
}

async function processOne(
	job: Job,
): Promise<"uploaded" | "skipped" | "failed"> {
	try {
		const head = await headS3Object(job.key);
		if (head) return "skipped";

		const res = await fetch(`${IMAGE_CDN}/${job.sourcePath}`);
		if (!res.ok) {
			console.warn(
				`  fetch failed [${res.status}] ${job.sourcePath}`,
			);
			return "failed";
		}
		const buf = Buffer.from(await res.arrayBuffer());
		await uploadToS3(job.key, buf, "image/jpeg");
		return "uploaded";
	} catch (err: any) {
		console.warn(`  error on ${job.sourcePath}: ${err?.message || err}`);
		return "failed";
	}
}

async function runBatched(
	jobs: Job[],
	concurrency: number,
): Promise<{ uploaded: number; skipped: number; failed: number }> {
	let uploaded = 0;
	let skipped = 0;
	let failed = 0;
	let cursor = 0;

	async function worker() {
		while (cursor < jobs.length) {
			const idx = cursor++;
			const job = jobs[idx];
			if (!job) break;
			const outcome = await processOne(job);
			if (outcome === "uploaded") uploaded++;
			else if (outcome === "skipped") skipped++;
			else failed++;
			if ((uploaded + skipped + failed) % 100 === 0) {
				console.log(
					`  progress: ${uploaded + skipped + failed}/${jobs.length} (uploaded=${uploaded} skipped=${skipped} failed=${failed})`,
				);
			}
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()),
	);
	return { uploaded, skipped, failed };
}

async function main() {
	console.log(`Fetching ${SOURCE_JSON}...`);
	const res = await fetch(SOURCE_JSON);
	if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
	const rows = (await res.json()) as SourceExercise[];
	console.log(`Loaded ${rows.length} exercises from source`);

	const jobs: Job[] = [];
	for (const row of rows) {
		for (const p of row.images ?? []) {
			jobs.push({ sourcePath: p, key: `${KEY_PREFIX}/${p}` });
		}
	}
	console.log(
		`Prepared ${jobs.length} image jobs (concurrency ${CONCURRENCY})`,
	);

	const totals = await runBatched(jobs, CONCURRENCY);
	console.log(
		`Done: uploaded=${totals.uploaded} skipped=${totals.skipped} failed=${totals.failed}`,
	);
	if (totals.failed > 0) {
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error("upload-exercise-images failed:", err);
	process.exit(1);
});
