/**
 * Branch-scoped staff-console reads.
 *
 * Admins read the branch they picked (?locationId= or the X-Location-Id
 * header) or every branch; trainers and other staff are held to their own.
 *
 * Needs a throwaway MongoDB and refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/branchscope bun run test:branch-scope
 */
import type { Request } from "express";
import mongoose from "mongoose";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import { branchFilter, resolveBranchScope } from "../src/utils/branch-scope";
import { LocationError } from "../src/utils/location.resolver";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}

function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  ❌ FAILED: ${message}`);
		throw new Error(message);
	}
	console.log(`  ✅ ${message}`);
}

const oid = () => new mongoose.Types.ObjectId();
const A = oid();
const B = oid();

/** Just enough of an express Request for resolveBranchScope. */
const fakeReq = (
	user: { id: string; role: string } | undefined,
	query: Record<string, unknown> = {},
	headers: Record<string, string> = {},
) =>
	({
		user: user ? { ...user, email: "x@test" } : undefined,
		query,
		get: (name: string) => headers[name.toLowerCase()],
	}) as unknown as Request;

async function main() {
	await mongoose.connect(url);
	const db = mongoose.connection.db;
	if (!db) throw new Error("not connected");
	await db.dropDatabase();

	const trainerAtA = oid();
	const trainerNoBranch = oid();
	const expertAtB = oid();
	await db.collection("trainers").insertMany([
		{ _id: trainerAtA, trainerName: "T-A", locationId: A },
		{ _id: trainerNoBranch, trainerName: "T-none" },
	]);
	await db.collection("users").insertOne({
		_id: expertAtB,
		username: "expert",
		homeLocationId: B,
	});
	// Touch the models so their collections are registered for findById.
	void Trainer;
	void User;

	console.log("\nadmin");
	const admin = { id: String(oid()), role: "admin" };
	assert((await resolveBranchScope(fakeReq(admin))) === null, "no pick → all branches");
	assert(
		(await resolveBranchScope(fakeReq(admin, {}, { "x-location-id": String(A) }))) ===
			String(A),
		"header picks the branch",
	);
	assert(
		(await resolveBranchScope(
			fakeReq(admin, { locationId: String(B) }, { "x-location-id": String(A) }),
		)) === String(B),
		"?locationId= wins over the header",
	);
	assert(
		(await resolveBranchScope(fakeReq(admin, { locationId: "all" }))) === null,
		'"all" → all branches',
	);
	let threw = false;
	try {
		await resolveBranchScope(fakeReq(admin, { locationId: "nope" }));
	} catch (err) {
		threw = err instanceof LocationError;
	}
	assert(threw, "malformed id → LocationError (400)");

	console.log("\ntrainer");
	const trainer = { id: String(trainerAtA), role: "trainer" };
	assert(
		(await resolveBranchScope(fakeReq(trainer))) === String(A),
		"held to their own branch",
	);
	assert(
		(await resolveBranchScope(
			fakeReq(trainer, { locationId: String(B) }, { "x-location-id": String(B) }),
		)) === String(A),
		"can't ask for another branch",
	);
	assert(
		(await resolveBranchScope(
			fakeReq({ id: String(trainerNoBranch), role: "trainer" }),
		)) === null,
		"no branch on record → unscoped, as before",
	);

	console.log("\nother staff");
	assert(
		(await resolveBranchScope(
			fakeReq({ id: String(expertAtB), role: "nutritionist" }, { locationId: String(A) }),
		)) === String(B),
		"expert held to their home branch",
	);

	console.log("\nmember");
	assert(
		(await resolveBranchScope(
			fakeReq({ id: String(oid()), role: "user" }, {}, { "x-location-id": String(A) }),
		)) === null,
		"header ignored for members",
	);

	console.log("\nbranchFilter");
	const f = await branchFilter(fakeReq(trainer), "homeLocationId");
	assert(String(f.homeLocationId) === String(A), "builds { field: ObjectId }");
	assert(
		Object.keys(await branchFilter(fakeReq(admin))).length === 0,
		"unscoped → {}",
	);

	await db.dropDatabase();
	await mongoose.disconnect();
	console.log("\nAll branch-scope checks passed.");
}

main().catch(async (err) => {
	console.error(err);
	await mongoose.disconnect().catch(() => undefined);
	process.exit(1);
});
