/**
 * FX-01 — every new record is saved with its branch.
 *
 * Needs a throwaway MongoDB and refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/fx01 bun run test:location-stamp
 *
 * Most checks call validate() instead of saving: the plugin runs before
 * validation, so the branch it chose is readable without building a fully
 * valid record of every model. Referenced records (slots, classes, members,
 * leads) are inserted raw so their own hooks don't interfere.
 */
import mongoose from "mongoose";
import Booking from "../src/models/Bookings";
import ClassModel from "../src/models/Class";
import CreditTransaction from "../src/models/CreditTransaction";
import {
	CreditTransactionSource,
	CreditTransactionType,
} from "../src/models/Enums";
import Invoice from "../src/models/Invoice";
import Lead from "../src/models/Lead";
import Membership from "../src/models/Membership";
import "../src/models/ScheduledSession";
import Slot from "../src/models/Slots";
import Trainer from "../src/models/Trainer";
import UnifiedBooking from "../src/models/UnifiedBooking";
import User from "../src/models/User";
import { resolveConcreteSlotForBooking } from "../src/services/slot-reservation.service";
import { clearDefaultLocationCache } from "../src/utils/location-stamp.plugin";

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
const A = oid(); // the default branch while it's the only active one
const B = oid();
const same = (x: unknown, y: unknown) => x != null && String(x) === String(y);
const db = () => {
	const conn = mongoose.connection.db;
	if (!conn) throw new Error("not connected");
	return conn;
};

/** The branch the plugin put on a new record, without needing it to be valid. */
async function stamped(
	Model: new (
		fields: Record<string, unknown>,
	) => { validate(): Promise<void>; get(path: string): unknown },
	fields: Record<string, unknown>,
	field = "locationId",
): Promise<unknown> {
	const doc = new Model(fields);
	await doc.validate().catch(() => undefined);
	return doc.get(field);
}

async function setBranches(active: mongoose.Types.ObjectId[]) {
	const locations = db().collection("locations");
	await locations.deleteMany({});
	await locations.insertMany([
		{ _id: A, name: "A", code: "A", isActive: active.some((x) => x.equals(A)) },
		{ _id: B, name: "B", code: "B", isActive: active.some((x) => x.equals(B)) },
	]);
	clearDefaultLocationCache();
}

async function run() {
	await mongoose.connect(url);
	await db().dropDatabase();
	const raw = (c: string) => db().collection(c);
	const warn = console.warn;
	const warnings: string[] = [];
	console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

	try {
		await setBranches([A]);

		// Referenced records, inserted raw.
		const memberAtB = oid();
		const memberNoHome = oid();
		await raw("users").insertMany([
			{ _id: memberAtB, username: "b", homeLocationId: B },
			{ _id: memberNoHome, username: "none", homeLocationId: null },
		]);
		const slotAtB = oid();
		const templateAtB = oid();
		const templateNoBranch = oid();
		await raw("slots").insertMany([
			{ _id: slotAtB, locationId: B },
			{ _id: templateAtB, locationId: B },
			{ _id: templateNoBranch, locationId: null },
		]);
		const classAtB = "class-at-b";
		await raw("classes").insertOne({
			_id: classAtB as never,
			name: "x",
			locationId: B,
		});
		const sessionOfClassAtB = oid();
		await raw("scheduledsessions").insertOne({
			_id: sessionOfClassAtB,
			classId: classAtB,
		});
		const leadAtB = oid();
		await raw("leads").insertOne({
			_id: leadAtB,
			leadName: "l",
			locationId: B,
		});

		console.log(
			"\n🔎 Records with no rule of their own take the default branch (FX-01.1)",
		);
		for (const [name, Model] of [
			["class", ClassModel],
			["slot", Slot],
			["trainer", Trainer],
			["lead", Lead],
		] as const) {
			assert(
				same(await stamped(Model, {}), A),
				`a new ${name} gets the default branch`,
			);
		}
		assert(
			same(await stamped(User, { username: "new" }, "homeLocationId"), A),
			"a new member gets a home branch (FX-01.3)",
		);

		console.log("\n🔎 What the caller passes is kept");
		assert(
			same(await stamped(ClassModel, { locationId: B }), B),
			"an explicit branch wins over the default",
		);
		assert(
			same(await stamped(Membership, { user: memberNoHome, locationId: B }), B),
			"and over the model's own rule",
		);

		console.log("\n🔎 A booking takes the branch of what it books (FX-01.2)");
		assert(
			same(
				await stamped(UnifiedBooking, {
					slotId: slotAtB,
					userId: memberNoHome,
				}),
				B,
			),
			"a unified booking takes its slot's branch, not the default",
		);
		assert(
			same(await stamped(UnifiedBooking, { userId: memberAtB }), B),
			"with no slot, it takes the member's home branch",
		);
		assert(
			same(
				await stamped(Booking, {
					sessionId: sessionOfClassAtB,
					user: memberNoHome,
				}),
				B,
			),
			"a class booking takes the class's branch through its session",
		);
		assert(
			same(
				await stamped(Booking, { classId: classAtB, user: memberNoHome }),
				B,
			),
			"or directly from the class",
		);
		assert(
			same(await stamped(Booking, { slot: slotAtB, user: memberNoHome }), B),
			"a service booking takes its slot's branch",
		);

		console.log("\n🔎 Money records take the member's home branch (FX-01.2)");
		assert(
			same(await stamped(Membership, { user: memberAtB }), B),
			"membership",
		);
		assert(
			same(await stamped(CreditTransaction, { user: memberAtB }), B),
			"credit entry",
		);
		assert(
			same(await stamped(Invoice, { userId: memberAtB }), B),
			"invoice to a member",
		);
		assert(
			same(await stamped(Invoice, { leadId: leadAtB }), B),
			"invoice to a lead takes the lead's branch",
		);
		assert(
			same(await stamped(Membership, { user: memberNoHome }), A),
			"a member with no home branch falls back to the default",
		);

		console.log("\n🔎 insertMany is covered too");
		{
			const membership = oid();
			const rows = [1, 2].map(() => ({
				user: memberAtB,
				membership,
				amount: 1,
				type: CreditTransactionType.Consume,
				sourceType: CreditTransactionSource.Booking,
			}));
			const saved = await CreditTransaction.insertMany(rows);
			assert(
				saved.every((r) => same(r.locationId, B)),
				"both inserted credit entries have the member's branch",
			);
			const stored = await raw("credittransactions").find({}).toArray();
			assert(
				stored.length === 2 && stored.every((r) => same(r.locationId, B)),
				"and that is what's stored",
			);
		}

		console.log("\n🔎 Upserts stamp the branch themselves");
		{
			const day = new Date("2026-10-01T00:00:00.000Z");
			const tpl = (
				id: mongoose.Types.ObjectId,
				locationId: mongoose.Types.ObjectId | null,
			) => ({
				_id: id,
				isDaily: true,
				startTime: "09:00",
				endTime: "10:00",
				capacity: 2,
				locationId,
			});
			const child = await resolveConcreteSlotForBooking(
				tpl(templateAtB, B),
				day,
			);
			assert(
				same(child?.locationId, B),
				"a daily slot's per-day copy takes the template's branch",
			);
			const child2 = await resolveConcreteSlotForBooking(
				tpl(templateNoBranch, null),
				day,
			);
			assert(
				same(child2?.locationId, A),
				"a template with no branch gives the copy the default",
			);
		}

		console.log("\n🔎 Existing records are not touched here (that's FX-02)");
		{
			const id = oid();
			await raw("leads").insertOne({
				_id: id,
				leadName: "old",
				status: "New",
				locationId: null,
			});
			const old = await Lead.findById(id);
			if (!old) throw new Error("seeded lead missing");
			old.set("notes", "edited");
			await old.save();
			const after = await raw("leads").findOne({ _id: id });
			assert(
				after?.locationId === null && after?.notes === "edited",
				"editing an old record leaves its branch empty",
			);
		}

		console.log("\n🔎 It never blocks a save (FX-01.4)");
		{
			await setBranches([A, B]);
			warnings.length = 0;
			assert(
				(await stamped(Lead, {})) == null,
				"with two active branches and none given, the branch is left empty",
			);
			assert(
				warnings.some((w) => w.includes("without a branch")),
				"and a warning is logged",
			);
			assert(
				same(await stamped(Lead, { locationId: B }), B),
				"an explicit branch still works",
			);
			assert(
				same(await stamped(Membership, { user: memberAtB }), B),
				"and so do the model rules, which don't need a default",
			);
			await setBranches([]);
			const saved = await Lead.create({ leadName: "no branches at all" });
			assert(
				Boolean(saved._id) && saved.get("locationId") == null,
				"with no branch configured the lead still saves",
			);
		}

		console.log("\n🎉 Location stamp tests passed!");
	} finally {
		console.warn = warn;
		await mongoose.connection.db?.dropDatabase();
		await mongoose.disconnect();
	}
}

run()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Location stamp test failed:", err);
		process.exit(1);
	});
