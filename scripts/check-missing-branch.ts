/**
 * FX-01.1 / FX-02: count records that have no branch. Read-only.
 *
 *   bun run check:missing-branch                        # every record
 *   bun run check:missing-branch -- --since 2026-09-29  # only ones created since
 *
 * Exits 1 when any are found, so it can gate a release checklist. Reads the
 * raw collections — no models, so nothing is created, indexed or stamped.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config();

// Collection → the field that holds its branch. Members only: staff stored
// as Users (experts) have no home branch by design.
const CHECKS: Array<{
	label: string;
	collection: string;
	field: string;
	filter?: Record<string, unknown>;
}> = [
	{ label: "class", collection: "classes", field: "locationId" },
	{ label: "slot", collection: "slots", field: "locationId" },
	{ label: "trainer", collection: "trainers", field: "locationId" },
	{ label: "membership", collection: "memberships", field: "locationId" },
	{ label: "booking (legacy)", collection: "bookings", field: "locationId" },
	{ label: "booking", collection: "unifiedbookings", field: "locationId" },
	{ label: "invoice", collection: "invoices", field: "locationId" },
	{
		label: "credit entry",
		collection: "credittransactions",
		field: "locationId",
	},
	{ label: "lead", collection: "leads", field: "locationId" },
	{
		label: "member",
		collection: "users",
		field: "homeLocationId",
		filter: { staffRole: null },
	},
];

async function main() {
	const args = process.argv.slice(2);
	const sinceArg = args.includes("--since")
		? args[args.indexOf("--since") + 1]
		: undefined;
	const since = sinceArg ? new Date(sinceArg) : null;
	if (sinceArg && Number.isNaN(since?.getTime())) {
		console.error(`--since "${sinceArg}" is not a date (use YYYY-MM-DD)`);
		process.exit(1);
	}

	const url = process.env.MONGODB_URL;
	if (!url) throw new Error("MONGODB_URL is not set");
	await mongoose.connect(url, { autoCreate: false, autoIndex: false });
	const db = mongoose.connection.db;
	if (!db) throw new Error("No database connection");

	console.log(`Database: ${db.databaseName}`);
	console.log(
		since ? `Records created since ${since.toISOString()}\n` : "All records\n",
	);
	console.log(
		`${"kind".padEnd(18)} ${"total".padStart(7)} ${"no branch".padStart(10)}`,
	);

	let missing = 0;
	for (const c of CHECKS) {
		const scope = {
			...c.filter,
			...(since ? { createdAt: { $gte: since } } : {}),
		};
		const col = db.collection(c.collection);
		const [total, without] = await Promise.all([
			col.countDocuments(scope),
			// $in [null] matches both a null value and a missing field.
			col.countDocuments({ ...scope, [c.field]: { $in: [null] } }),
		]);
		missing += without;
		console.log(
			`${c.label.padEnd(18)} ${String(total).padStart(7)} ${String(without).padStart(10)}${without ? "  ←" : ""}`,
		);
	}

	console.log(
		missing
			? `\n${missing} records have no branch.`
			: "\nEvery record has a branch.",
	);
	process.exitCode = missing ? 1 : 0;
}

main()
	.catch((err) => {
		console.error("Branch check failed:", err);
		process.exitCode = 2;
	})
	.finally(() => mongoose.disconnect());
