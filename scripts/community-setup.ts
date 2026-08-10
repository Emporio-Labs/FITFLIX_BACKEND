import { config } from "dotenv";
import mongoose from "mongoose";
import Block from "../src/models/Block";
import Comment from "../src/models/Comment";
import Like from "../src/models/Like";
import ModerationAction from "../src/models/ModerationAction";
import Post from "../src/models/Post";
import PostMedia from "../src/models/PostMedia";
import PostVersion from "../src/models/PostVersion";
import Report from "../src/models/Report";
import Share from "../src/models/Share";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

// Every collection this module owns. User/Membership are REUSED and never
// touched here — `down` must not drop shared data.
const COMMUNITY_MODELS = [
	Post,
	PostMedia,
	PostVersion,
	Comment,
	Like,
	Share,
	Block,
	Report,
	ModerationAction,
] as const;

// The two append-only collections that get the restricted DB role.
const APPEND_ONLY_MODELS = [PostVersion, ModerationAction] as const;

/** `up`: create every collection's indexes (idempotent). */
async function up(): Promise<void> {
	for (const model of COMMUNITY_MODELS) {
		await model.syncIndexes();
		console.log(`  ✓ indexes synced: ${model.collection.name}`);
	}
	console.log("\nUP complete — community collections & indexes are ready.");
	printRestrictedRole();
}

/**
 * `down`: drop ONLY the community collections (which also drops their indexes),
 * leaving all shared/existing data untouched. Reversible: re-run `up`.
 */
async function down(): Promise<void> {
	for (const model of COMMUNITY_MODELS) {
		try {
			await model.collection.drop();
			console.log(`  ✓ dropped: ${model.collection.name}`);
		} catch (error) {
			// NamespaceNotFound (26) — collection was never created. Idempotent.
			if ((error as { code?: number }).code === 26) {
				console.log(`  – skip (absent): ${model.collection.name}`);
			} else {
				throw error;
			}
		}
	}
	console.log("\nDOWN complete — community collections removed.");
}

/**
 * Emit the mongosh recipe for a database role that can only READ and INSERT the
 * two append-only collections (no update/remove). Application-layer guards
 * (utils/mongoose-append-only.ts) already block every in-app write path; this
 * role is defence-in-depth for anything that bypasses Mongoose (e.g. a raw
 * mongosh session or a dedicated append-only connection).
 *
 * MongoDB privileges are additive, so this is intentionally a narrow
 * find+insert-only role rather than an unmaintainable "everything-except"
 * grant — keeping it robust as new collections are added elsewhere.
 */
function printRestrictedRole(): void {
	const dbName = mongoose.connection.name;
	const collections = APPEND_ONLY_MODELS.map((m) => m.collection.name);
	const privileges = collections
		.map(
			(c) =>
				`    { resource: { db: "${dbName}", collection: "${c}" }, actions: ["find", "insert"] }`,
		)
		.join(",\n");

	console.log(
		"\n────────────────────────────────────────────────────────────────────",
	);
	console.log("Optional DB-level hardening (run in mongosh as a DB admin):");
	console.log(
		"────────────────────────────────────────────────────────────────────",
	);
	console.log(`db.getSiblingDB("${dbName}").createRole({
  role: "community_append_only_writer",
  privileges: [
${privileges}
  ],
  roles: []
});`);
	console.log(
		"\nBind a dedicated append-only connection/user to this role to reject " +
			"UPDATE/DELETE on these collections at the server, not just in-app.",
	);
	console.log(
		"────────────────────────────────────────────────────────────────────\n",
	);
}

/** Rewrite a connection string onto an isolated `<db>_community_test` database. */
function toTestDbUrl(url: string): string {
	const parts = url.split("?");
	const base = parts[0] ?? url;
	const query = parts[1];
	const schemeIdx = base.indexOf("://");
	const afterScheme = base.slice(schemeIdx + 3);
	const slashIdx = afterScheme.indexOf("/");
	const hostPart = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
	const dbPart = slashIdx === -1 ? "" : afterScheme.slice(slashIdx + 1);
	const baseDb = dbPart.length > 0 ? dbPart : "fitflix";
	const rebuilt = `${base.slice(0, schemeIdx + 3)}${hostPart}/${baseDb}_community_test`;
	return query ? `${rebuilt}?${query}` : rebuilt;
}

async function main(): Promise<void> {
	const direction = hasFlag("--down") ? "down" : "up";
	// `--test` runs against an isolated <db>_community_test database — safe for
	// verifying up/down without touching real collections.
	const isTest = hasFlag("--test");

	try {
		if (isTest) {
			const raw = process.env.MONGODB_URL;
			if (!raw) {
				throw new Error("MONGODB_URL is not configured in .env");
			}
			await mongoose.connect(toTestDbUrl(raw));
		} else {
			await connectDB();
		}
		console.log(
			`Running community-setup: ${direction.toUpperCase()}` +
				`${isTest ? ` (test db: ${mongoose.connection.name})` : ""}\n`,
		);

		if (direction === "down") {
			await down();
		} else {
			await up();
		}
	} catch (error) {
		console.error("community-setup failed:", error);
		await mongoose.disconnect();
		process.exit(1);
	}

	await mongoose.disconnect();
	process.exit(0);
}

main();
