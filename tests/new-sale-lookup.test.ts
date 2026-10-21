/**
 * New sale, backend part 2: plans per branch (B6), the lead Converted guard
 * and pendingInvoiceId (B7), GET /people/lookup (B8), optional User.age (B9).
 *
 * Needs a throwaway MongoDB and refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/sale bun run test:new-sale-lookup
 *
 * Handlers are called directly with a stub request/response; the routes add
 * only authenticateToken + authorize on top.
 */
import type { RequestHandler } from "express";
import mongoose from "mongoose";
import {
	createLead,
	getAllLeads,
	updateLeadById,
} from "../src/controllers/lead.controller";
import {
	createMembershipPlan,
	getAllMembershipPlans,
} from "../src/controllers/membershipPlan.controller";
import { lookupPeople } from "../src/controllers/people.controller";
import User from "../src/models/User";
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
const A = oid();
const B = oid();
const db = () => {
	const conn = mongoose.connection.db;
	if (!conn) throw new Error("not connected");
	return conn;
};
const raw = (c: string) => db().collection(c);

/** Run a handler; resolves with the status and JSON body it sent. */
async function call(
	handler: RequestHandler,
	req: {
		body?: unknown;
		query?: Record<string, string>;
		params?: Record<string, string>;
	},
): Promise<{ status: number; body: any }> {
	return new Promise((resolve, reject) => {
		let status = 200;
		const res = {
			status(code: number) {
				status = code;
				return res;
			},
			json(body: unknown) {
				// Round-trip like Express does, so toJSON transforms apply.
				resolve({ status, body: JSON.parse(JSON.stringify(body)) });
				return res;
			},
		};
		const next = (err?: unknown) =>
			err ? reject(err) : reject(new Error("handler called next()"));
		Promise.resolve(
			handler(
				{ body: {}, query: {}, params: {}, ...req } as never,
				res as never,
				next as never,
			),
		).catch(reject);
	});
}

async function run() {
	await mongoose.connect(url);
	await db().dropDatabase();

	try {
		// Two branches; A is the only active one, so it is the default.
		await raw("locations").insertMany([
			{ _id: A, name: "A", code: "a", isActive: true },
			{ _id: B, name: "B", code: "b", isActive: false },
		]);
		clearDefaultLocationCache();

		console.log("\nB6 — plans per branch");
		{
			const created = await call(createMembershipPlan, {
				body: { name: "All branches", price: 1000, gymId: "g" },
			});
			assert(created.status === 201, "a plan without a branch is created");
			assert(
				created.body.plan.locationId === null,
				"and stays an all-branch plan (not stamped with the default branch)",
			);
			const atB = await call(createMembershipPlan, {
				body: { name: "At B", price: 1, gymId: "g", locationId: String(B) },
			});
			assert(
				atB.status === 400 && atB.body.code === "LOCATION_INACTIVE",
				"a plan for an inactive branch is refused",
			);
			const past = new Date(Date.now() - 86_400_000);
			await raw("membershipplans").insertMany([
				{
					name: "Founding at A",
					locationId: A,
					isFounding: true,
					availableUntil: null,
				},
				{ name: "Expired at A", locationId: A, availableUntil: past },
				{ name: "Only at B", locationId: B },
				{ name: "Legacy plan" }, // saved before locationId existed
			]);
			const names = async (query: Record<string, string>) =>
				(await call(getAllMembershipPlans, { query })).body.plans
					.map((p: { name: string }) => p.name)
					.sort();

			const forA = await names({ locationId: String(A) });
			assert(
				JSON.stringify(forA) ===
					JSON.stringify(["All branches", "Founding at A", "Legacy plan"]),
				"?locationId=A returns A's plans and all-branch plans, hiding expired ones",
			);
			const forAAll = await names({
				locationId: String(A),
				includeExpired: "true",
			});
			assert(
				forAAll.includes("Expired at A"),
				"includeExpired=true shows them",
			);
			assert(!forAAll.includes("Only at B"), "never another branch's plan");
			const bad = await call(getAllMembershipPlans, {
				query: { locationId: "nope" },
			});
			assert(bad.status === 400, "a malformed locationId is a 400");
		}

		console.log("\nB7 — lead guard and pendingInvoiceId");
		{
			const refusedCreate = await call(createLead, {
				body: { leadName: "x", status: "Converted" },
			});
			assert(
				refusedCreate.status === 400 &&
					refusedCreate.body.code === "LEAD_CONVERSION_NOT_ALLOWED",
				"a lead can't be created as Converted",
			);
			const lead = await call(createLead, {
				body: { leadName: "Ravi Kumar", phone: "+91 98765 43210" },
			});
			const leadId = lead.body.lead._id as string;
			const refused = await call(updateLeadById, {
				params: { id: leadId },
				body: { status: "Converted" },
			});
			assert(
				refused.status === 400 &&
					refused.body.code === "LEAD_CONVERSION_NOT_ALLOWED",
				"PATCH /leads/:id refuses status Converted",
			);
			const ok = await call(updateLeadById, {
				params: { id: leadId },
				body: { status: "Hot" },
			});
			assert(ok.status === 200, "other statuses still update");

			const older = oid();
			const newer = oid();
			const leadOid = new mongoose.Types.ObjectId(leadId);
			await raw("invoices").insertMany([
				{
					_id: older,
					invoiceNumber: "I-1",
					leadId: leadOid,
					total: 10,
					paymentStatus: "DRAFT",
					createdAt: new Date(1000),
				},
				{
					_id: newer,
					invoiceNumber: "I-2",
					leadId: leadOid,
					total: 20,
					paymentStatus: "PENDING",
					createdAt: new Date(2000),
				},
				{
					_id: oid(),
					invoiceNumber: "I-3",
					leadId: leadOid,
					total: 30,
					paymentStatus: "PAID",
					createdAt: new Date(3000),
				},
			]);
			await call(createLead, { body: { leadName: "No invoice" } });
			const list = await call(getAllLeads, {});
			const byName = (n: string) =>
				list.body.leads.find((l: { leadName: string }) => l.leadName === n);
			assert(
				byName("Ravi Kumar").pendingInvoiceId === String(newer),
				"a lead's pendingInvoiceId is its newest DRAFT/PENDING invoice",
			);
			assert(
				byName("No invoice").pendingInvoiceId === null,
				"and null when it has none",
			);
			assert(
				typeof byName("Ravi Kumar")._id === "string",
				"lead list items keep _id",
			);
		}

		console.log("\nB8 — GET /people/lookup");
		{
			const member = oid();
			await raw("users").insertOne({
				_id: member,
				username: "Ravi Member",
				phone: "9876543210",
				email: "ravi@example.com",
				homeLocationId: A,
			});
			const current = oid();
			await raw("memberships").insertMany([
				{
					user: member,
					planName: "Old",
					status: "Expired",
					startDate: new Date("2025-01-01"),
					endDate: new Date("2027-12-31"),
					locationId: A,
				},
				{
					_id: current,
					user: member,
					planName: "Now",
					status: "Paused",
					startDate: new Date("2026-06-01"),
					endDate: new Date("2026-12-31"),
					locationId: A,
				},
				{
					user: member,
					planName: "Earlier",
					status: "Active",
					startDate: new Date("2026-01-01"),
					endDate: new Date("2026-11-30"),
					locationId: A,
				},
			]);
			const memberInvoice = oid();
			await raw("invoices").insertOne({
				_id: memberInvoice,
				invoiceNumber: "I-9",
				userId: member,
				total: 99,
				paymentStatus: "DRAFT",
				locationId: A,
				createdAt: new Date(),
			});

			const byPhone = await call(lookupPeople, {
				query: { q: "+91 98765-43210" },
			});
			assert(byPhone.status === 200, "a phone search returns 200");
			assert(
				byPhone.body.members.length === 1 &&
					byPhone.body.members[0]._id === String(member),
				"a phone with +91 and separators finds the member on the last 10 digits",
			);
			const cm = byPhone.body.members[0].currentMembership;
			assert(
				cm && cm._id === String(current) && cm.status === "Paused",
				"currentMembership is the Active/Paused/Upcoming one ending last (Expired ignored)",
			);
			assert(
				byPhone.body.leads.length === 1 &&
					byPhone.body.leads[0].name === "Ravi Kumar" &&
					typeof byPhone.body.leads[0].pendingInvoiceId === "string",
				"the lead saved as '+91 98765 43210' matches too, with its pendingInvoiceId",
			);
			const invIds = byPhone.body.pendingInvoices.map(
				(i: { _id: string }) => i._id,
			);
			assert(
				invIds.includes(String(memberInvoice)) && invIds.length === 3,
				"pendingInvoices holds the open invoices of matched members and leads",
			);

			const partial = await call(lookupPeople, { query: { q: "5432" } });
			assert(
				partial.body.members.length === 1,
				"four digits are a partial phone search",
			);

			const byName = await call(lookupPeople, { query: { q: "rAvI" } });
			assert(
				byName.body.members.length === 1 && byName.body.leads.length === 1,
				"a name search is case-insensitive across members and leads",
			);
			const byEmail = await call(lookupPeople, {
				query: { q: "RAVI@example" },
			});
			assert(byEmail.body.members.length === 1, "and matches email");
			const regexy = await call(lookupPeople, { query: { q: ".*" } });
			assert(
				regexy.body.members.length === 0 && regexy.body.leads.length === 0,
				"regex characters in q are matched literally",
			);
			const empty = await call(lookupPeople, { query: { q: " " } });
			assert(empty.status === 400, "a blank q is a 400");
		}

		console.log("\nB9 — User.age optional");
		{
			const user = new User({
				username: "Desk sale",
				phone: "9000000000",
				gender: "Male",
			});
			const err = await user.validate().then(
				() => null,
				(e) => e,
			);
			assert(err === null, "a user validates without an age");
		}

		console.log("\n🎉 New sale lookup tests passed!");
	} finally {
		await mongoose.connection.db?.dropDatabase();
		await mongoose.disconnect();
	}
}

run()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("New sale lookup test failed:", err);
		process.exit(1);
	});
