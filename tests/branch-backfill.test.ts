/**
 * FX-02 — existing records get their branch. Against a throwaway local
 * MongoDB only:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/fx02 bun run test:branch-backfill
 *
 * Branch A is active (the default); B is inactive, so a record that ends up
 * at B can only have got there by its own rule, never by the default.
 */
import mongoose from "mongoose";
import { backfillBranches } from "../src/utils/branch-backfill";

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

async function run() {
	await mongoose.connect(url, { autoCreate: false, autoIndex: false });
	const db = mongoose.connection.db;
	if (!db) throw new Error("not connected");
	await db.dropDatabase();
	const c = (name: string) => db.collection(name);
	const branch = async (col: string, id: unknown, field = "locationId") =>
		String((await c(col).findOne({ _id: id as never }))?.[field] ?? null);

	// ── Seed: pre-FX-01 data ─────────────────────────────────────────────
	await c("locations").insertMany([
		{ _id: A, name: "A", isActive: true },
		{ _id: B, name: "B", isActive: false },
	]);
	const memberAtB = oid();
	const memberNone = oid();
	const memberMissing = oid();
	const expert = oid();
	await c("users").insertMany([
		{ _id: memberAtB, staffRole: null, homeLocationId: B },
		{ _id: memberNone, staffRole: null, homeLocationId: null },
		{ _id: memberMissing, staffRole: null },
		{ _id: expert, staffRole: "nutritionist", homeLocationId: null },
	]);
	await c("classes").insertMany([
		{ _id: "class-b" as never, locationId: B },
		{ _id: "class-none" as never, locationId: null },
	]);
	const slotAtB = oid();
	const tplAtB = oid();
	const childOfTpl = oid();
	const slotNone = oid();
	await c("slots").insertMany([
		{ _id: slotAtB, locationId: B },
		{ _id: tplAtB, locationId: B, isDaily: true },
		{ _id: childOfTpl, parentTemplate: tplAtB, locationId: null },
		{ _id: slotNone, locationId: null },
	]);
	const sessOfClassB = oid();
	await c("scheduledsessions").insertOne({
		_id: sessOfClassB,
		classId: "class-b",
	});
	await c("trainers").insertOne({ _id: oid(), locationId: null });
	const leadAtB = oid();
	await c("leads").insertMany([
		{ _id: leadAtB, locationId: B },
		{ _id: oid(), leadName: "old lead" },
	]);
	const ub = { slot: oid(), home: oid(), none: oid(), preset: oid() };
	await c("unifiedbookings").insertMany([
		{ _id: ub.slot, slotId: slotAtB, userId: memberNone },
		{ _id: ub.home, userId: memberAtB },
		{ _id: ub.none, userId: memberNone },
		{ _id: ub.preset, slotId: slotAtB, locationId: A },
	]);
	const bk = {
		session: oid(),
		klass: oid(),
		slot: oid(),
		home: oid(),
		none: oid(),
	};
	await c("bookings").insertMany([
		{ _id: bk.session, sessionId: sessOfClassB, user: memberNone },
		{ _id: bk.klass, classId: "class-b", user: memberNone },
		{ _id: bk.slot, slot: slotAtB, user: memberNone },
		{ _id: bk.home, user: memberAtB },
		{ _id: bk.none, user: memberNone },
	]);
	const ms = { atB: oid(), none: oid() };
	await c("memberships").insertMany([
		{ _id: ms.atB, user: memberAtB, locationId: null },
		{ _id: ms.none, user: memberNone, locationId: null },
	]);
	const credit = oid();
	await c("credittransactions").insertOne({
		_id: credit,
		user: memberAtB,
		locationId: null,
	});
	const inv = { member: oid(), lead: oid(), none: oid() };
	await c("invoices").insertMany([
		{ _id: inv.member, userId: memberAtB },
		{ _id: inv.lead, leadId: leadAtB },
		{ _id: inv.none },
	]);

	const snapshot = async () => {
		const out: Record<string, unknown> = {};
		for (const name of (await db.listCollections().toArray())
			.map((x) => x.name)
			.sort()) {
			out[name] = await c(name).find({}).sort({ _id: 1 }).toArray();
		}
		return JSON.stringify(out);
	};

	console.log("\n🔎 Dry run reports and changes nothing (FX-02.1)");
	{
		const before = await snapshot();
		const r = await backfillBranches(db, { apply: false });
		assert(
			(await snapshot()) === before,
			"database is byte-for-byte unchanged",
		);
		assert(
			r.kinds.every((k) => k.written === 0),
			"nothing reported as written",
		);
		const k = (label: string) => r.kinds.find((x) => x.label === label);
		assert(
			k("member")?.missing === 2,
			"counts 2 members with no home branch (expert excluded)",
		);
		assert(
			k("booking")?.missing === 3,
			"counts 3 bookings with no branch (the preset one excluded)",
		);
		assert(k("booking (legacy)")?.missing === 5, "counts 5 legacy bookings");
		assert(
			r.defaultLocationId === String(A),
			"the one active branch is the default",
		);
	}

	console.log("\n🔎 Apply fills every kind by its rule");
	{
		const r = await backfillBranches(db, { apply: true });
		assert(
			r.kinds.every((k) => k.unresolved === 0),
			"nothing left unresolved",
		);
		assert(
			(await branch("users", memberNone, "homeLocationId")) === String(A),
			"member with no home → default",
		);
		assert(
			(await branch("users", memberMissing, "homeLocationId")) === String(A),
			"member with the field missing → default",
		);
		assert(
			(await branch("users", memberAtB, "homeLocationId")) === String(B),
			"member's existing home kept",
		);
		assert(
			(await branch("users", expert, "homeLocationId")) === "null",
			"expert left without a home branch",
		);
		assert(
			(await branch("classes", "class-none")) === String(A),
			"class → default",
		);
		assert(
			(await branch("slots", childOfTpl)) === String(B),
			"a daily slot's copy → its template's branch",
		);
		assert(
			(await branch("slots", slotNone)) === String(A),
			"other slot → default",
		);
		assert(
			(await branch("unifiedbookings", ub.slot)) === String(B),
			"booking → its slot's branch",
		);
		assert(
			(await branch("unifiedbookings", ub.home)) === String(B),
			"booking with no slot → member's home",
		);
		assert(
			(await branch("unifiedbookings", ub.none)) === String(A),
			"booking with neither → default",
		);
		assert(
			(await branch("unifiedbookings", ub.preset)) === String(A),
			"a booking that already had a branch is not overwritten",
		);
		assert(
			(await branch("bookings", bk.session)) === String(B),
			"legacy booking → class branch via its session",
		);
		assert(
			(await branch("bookings", bk.klass)) === String(B),
			"legacy booking → its class",
		);
		assert(
			(await branch("bookings", bk.slot)) === String(B),
			"legacy booking → its slot",
		);
		assert(
			(await branch("bookings", bk.home)) === String(B),
			"legacy booking → member's home",
		);
		assert(
			(await branch("bookings", bk.none)) === String(A),
			"legacy booking with nothing → default",
		);
		assert(
			(await branch("memberships", ms.atB)) === String(B),
			"membership → member's home",
		);
		assert(
			(await branch("memberships", ms.none)) === String(A),
			"membership of a member with no home → default",
		);
		assert(
			(await branch("credittransactions", credit)) === String(B),
			"credit entry → member's home",
		);
		assert(
			(await branch("invoices", inv.member)) === String(B),
			"invoice → member's home",
		);
		assert(
			(await branch("invoices", inv.lead)) === String(B),
			"invoice to a lead → lead's branch",
		);
		assert(
			(await branch("invoices", inv.none)) === String(A),
			"invoice with neither → default",
		);
	}

	console.log("\n🔎 A second run changes nothing (FX-02.2)");
	{
		const before = await snapshot();
		const r = await backfillBranches(db, { apply: true });
		assert(
			r.kinds.every((k) => k.written === 0 && k.missing === 0),
			"nothing missing, nothing written",
		);
		assert((await snapshot()) === before, "database unchanged");
	}

	console.log("\n🔎 With two active branches, only the rules apply");
	{
		await c("locations").updateOne({ _id: B }, { $set: { isActive: true } });
		const orphan = oid();
		const placed = oid();
		await c("leads").insertOne({ _id: orphan, locationId: null });
		await c("unifiedbookings").insertOne({
			_id: placed,
			slotId: slotAtB,
			locationId: null,
		});
		const r = await backfillBranches(db, { apply: true });
		assert(r.defaultLocationId === null, "there is no default");
		assert(
			(await branch("leads", orphan)) === "null",
			"a lead with no rule is left empty",
		);
		assert(
			r.kinds.find((k) => k.label === "lead")?.unresolved === 1,
			"and reported as unresolved",
		);
		assert(
			(await branch("unifiedbookings", placed)) === String(B),
			"a booking still gets its slot's branch",
		);
	}

	console.log("\n🎉 Branch backfill tests passed!");
	await db.dropDatabase();
	await mongoose.disconnect();
}

run()
	.then(() => process.exit(0))
	.catch(async (err) => {
		console.error("Branch backfill test failed:", err);
		await mongoose.disconnect().catch(() => undefined);
		process.exit(1);
	});
