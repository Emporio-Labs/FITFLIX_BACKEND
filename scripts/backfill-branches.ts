/**
 * FX-02: give records created before FX-01 their branch.
 *
 *   bun run backfill:branches            # dry run (default): counts, writes nothing
 *   bun run backfill:branches -- --apply # write
 *
 * Rules and order: utils/branch-backfill.ts. Safe to re-run — only empty
 * branches are filled. Deploy FX-01 first, so nothing created after the
 * backfill is left without a branch; runbook: docs/runbooks/fx-02-branch-backfill.md.
 */
import { config } from "dotenv";
import mongoose from "mongoose";
import { backfillBranches } from "../src/utils/branch-backfill";

config();

async function main() {
	const apply = process.argv.slice(2).includes("--apply");
	const url = process.env.MONGODB_URL;
	if (!url) throw new Error("MONGODB_URL is not set");

	// No models are loaded, but make sure nothing gets created on connect.
	await mongoose.connect(url, { autoCreate: false, autoIndex: false });
	const db = mongoose.connection.db;
	if (!db) throw new Error("No database connection");

	console.log(`Database: ${db.databaseName}`);
	console.log(
		apply
			? "Mode: APPLY — branches will be written"
			: "Mode: DRY RUN — nothing will be written",
	);

	const report = await backfillBranches(db, { apply });
	console.log(
		report.defaultLocationId
			? `Default branch: ${report.defaultLocationId}\n`
			: `No default branch (${report.activeLocations} active) — records the rules can't place stay empty\n`,
	);

	const cols = [
		"total",
		"no branch",
		"from rule",
		"default",
		"unresolved",
		"written",
	];
	console.log(
		`${"kind".padEnd(18)} ${cols.map((c) => c.padStart(10)).join(" ")}`,
	);
	for (const k of report.kinds) {
		const n = [
			k.total,
			k.missing,
			k.fromRule,
			k.fromDefault,
			k.unresolved,
			k.written,
		];
		console.log(
			`${k.label.padEnd(18)} ${n.map((x) => String(x).padStart(10)).join(" ")}`,
		);
	}

	const sum = (f: (k: (typeof report.kinds)[number]) => number) =>
		report.kinds.reduce((a, k) => a + f(k), 0);
	const unresolved = sum((k) => k.unresolved);
	console.log(
		apply
			? `\nWrote ${sum((k) => k.written)} branches. ${unresolved} left unresolved. Now run: bun run check:missing-branch`
			: `\n${sum((k) => k.fromRule + k.fromDefault)} records would get a branch; ${unresolved} would stay empty. Re-run with --apply to write.`,
	);
	process.exitCode = unresolved ? 1 : 0;
}

main()
	.catch((err) => {
		console.error("Branch backfill failed:", err);
		process.exitCode = 2;
	})
	.finally(() => mongoose.disconnect());
