/**
 * New sale flow: an invoice carries the sale, resolves the member account,
 * and paying it builds the membership (B1–B5, B9).
 *
 * Needs a throwaway MongoDB replica set (paying runs in a transaction) and
 * refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27031:27017 mongo:7 --replSet rs0
 *   docker exec <id> mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
 *   TEST_MONGODB_URL='mongodb://127.0.0.1:27031/newsale?directConnection=true' bun run test:new-sale
 */
import mongoose from "mongoose";
import { LeadStatus, MembershipStatus } from "../src/models/Enums";
import Invoice from "../src/models/Invoice";
import Lead from "../src/models/Lead";
import Membership from "../src/models/Membership";
import User from "../src/models/User";
import { activateDueMemberships } from "../src/services/membership-lifecycle.service";
import { clearDefaultLocationCache } from "../src/utils/location-stamp.plugin";
import {
	addCalendarMonths,
	resolveMembershipTerm,
} from "../src/utils/membership-term";
import { formatDateInZone } from "../src/utils/timezone.util";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}
process.env.MONGODB_URL = url;
process.env.JWT_SECRET ??= "new-sale-test-secret";

const IST = "Asia/Kolkata";
const oid = () => new mongoose.Types.ObjectId();
const A = oid();
const B = oid();
const PLAN = oid();
const deskId = String(oid());
const adminId = String(oid());
const desk = generateTestToken("frontdesk", deskId);
const admin = generateTestToken("admin", adminId);
const same = (x: unknown, y: unknown) => x != null && String(x) === String(y);

const istDayPlus = (days: number) =>
	formatDateInZone(new Date(Date.now() + days * 86_400_000), IST);

const saleBody = (extra: Record<string, unknown>) => ({
	items: [{ name: "Quarterly", price: 9000, quantity: 1 }],
	discount: 1000,
	planSnapshot: {
		name: "Quarterly",
		durationInDays: 90,
		price: 9000,
		includedCredits: 12,
	},
	...extra,
});

async function post(
	baseUrl: string,
	body: unknown,
	headers: Record<string, string> = {},
) {
	const res = await fetch(`${baseUrl}/invoices`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${desk}`,
			...headers,
		},
		body: JSON.stringify(body),
	});
	return { status: res.status, data: (await res.json()) as any };
}

function pureChecks() {
	console.log("\n— term arithmetic");
	assert(
		addCalendarMonths("2026-01-31", 1) === "2026-02-28",
		"31 Jan + 1 month clamps to 28 Feb",
	);
	assert(
		addCalendarMonths("2026-11-15", 3) === "2027-02-15",
		"months roll over the year",
	);
	const term = resolveMembershipTerm({
		startDay: "2026-12-01",
		durationMonths: 12,
		durationInDays: 30,
		timeZone: IST,
		now: new Date("2026-10-22T06:00:00Z"),
	});
	assert(
		term.startDate.toISOString() === "2026-11-30T18:30:00.000Z",
		"start is branch midnight",
	);
	assert(
		term.endDate.toISOString() === "2027-11-30T18:30:00.000Z",
		"12 months lands on the same day a year later",
	);
	assert(
		term.status === MembershipStatus.Upcoming,
		"a future start is Upcoming",
	);
	const today = resolveMembershipTerm({
		durationInDays: 30,
		timeZone: IST,
		now: new Date("2026-10-22T06:00:00Z"),
	});
	assert(
		today.status === MembershipStatus.Active,
		"no start date is Active today",
	);
	assert(
		(today.endDate.getTime() - today.startDate.getTime()) / 86_400_000 === 30,
		"without months it runs durationInDays",
	);
}

async function run() {
	pureChecks();

	const server = await startTestServer();
	const db = mongoose.connection.db!;
	await db.dropDatabase();
	await Invoice.syncIndexes();
	await db.collection("locations").insertMany([
		{
			_id: A,
			name: "A",
			code: "A",
			isActive: true,
			settings: { taxRatePercent: 18 },
		},
		{
			_id: B,
			name: "B",
			code: "B",
			isActive: true,
			settings: { taxRatePercent: 5 },
		},
	]);
	await db
		.collection("membershipplans")
		.insertOne({ _id: PLAN, planName: "Quarterly" });
	clearDefaultLocationCache();

	// User.age/gender are made optional by the be-sale-lookup PR; mirror
	// that here so a lead without them can become an account.
	User.schema.path("age").required(false);
	User.schema.path("gender").required(false);

	try {
		console.log("\n— B1/B2 invoice carries the sale and resolves the person");
		const walkIn = {
			name: "Asha Rao",
			phone: "+91 98480 11111",
			email: "asha@example.com",
		};
		const noBranch = await post(server.baseUrl, saleBody({ newLead: walkIn }));
		assert(
			noBranch.status === 400 && noBranch.data.code === "LOCATION_REQUIRED",
			"two active branches: locationId is required",
		);

		const start = istDayPlus(10);
		const body = saleBody({
			newLead: walkIn,
			locationId: String(B),
			planId: String(PLAN),
			startDate: start,
			durationMonths: 3,
			discountReason: "Founding member",
		});
		const created = await post(server.baseUrl, body, {
			"Idempotency-Key": "k1",
		});
		assert(created.status === 201, `invoice created (${created.status})`);
		const inv = created.data.invoice;
		assert(!!inv.userId, "invoice has userId at creation");
		assert(same(inv.locationId, B), "branch honoured as sent");
		assert(inv.tax === 400, `tax is 5% of discounted 8000 (got ${inv.tax})`);
		assert(inv.total === 8400, "total = subtotal + tax - discount");
		assert(
			inv.startDate === start && inv.durationMonths === 3,
			"sale fields stored",
		);

		const lead = await Lead.findOne({ phone: "9848011111" });
		assert(
			!!lead && same(lead.locationId, B),
			"walk-in became a lead at the invoice branch",
		);
		assert(same(lead?.convertedUser, inv.userId), "lead linked to the account");
		assert(
			lead?.status !== LeadStatus.Converted,
			"lead not Converted until paid",
		);
		const user = await User.findById(inv.userId);
		assert(
			user?.phone === "9848011111" && same(user?.homeLocationId, B),
			"account made from the lead, home branch B",
		);

		const again = await post(server.baseUrl, body, { "Idempotency-Key": "k1" });
		assert(
			again.status === 200 &&
				same(
					again.data.invoice._id ?? again.data.invoice.id,
					inv._id ?? inv.id,
				),
			"same Idempotency-Key returns the same invoice",
		);
		assert((await Invoice.countDocuments()) === 1, "no second invoice");

		const invId = inv._id ?? inv.id;
		console.log("\n— B3 paying builds the membership from the invoice");
		const paid = await fetchJson(server.baseUrl, `/invoices/${invId}/status`, {
			method: "PATCH",
			token: desk,
			body: {
				paymentStatus: "PAID",
				paymentMethod: "UPI",
				paymentReference: "UPI-123",
			},
		});
		assert(paid.status === 200, `marked paid (${paid.status})`);
		const m = await Membership.findOne({ invoiceId: invId });
		assert(!!m, "membership linked to invoice");
		assert(m?.status === MembershipStatus.Upcoming, "future start → Upcoming");
		assert(
			same(m?.planId, PLAN) && same(m?.locationId, B),
			"planId and invoice branch",
		);
		assert(
			formatDateInZone(m!.startDate, IST) === start &&
				formatDateInZone(m!.endDate!, IST) === addCalendarMonths(start, 3),
			"runs 3 calendar months from the chosen start",
		);
		const paidInv = await Invoice.findById(invId);
		assert(
			paidInv?.paymentReference === "UPI-123" &&
				same(paidInv?.recordedBy, deskId),
			"reference and recorder stored",
		);
		assert(
			(await Lead.findById(lead!._id))?.status === LeadStatus.Converted,
			"lead Converted on payment",
		);

		console.log("\n— B4 overlap guard");
		const overlapping = await post(
			server.baseUrl,
			saleBody({
				userId: String(inv.userId),
				locationId: String(B),
				startDate: istDayPlus(20),
			}),
		);
		assert(
			overlapping.status === 409 &&
				overlapping.data.code === "MEMBERSHIP_OVERLAP" &&
				same(overlapping.data.details?.conflictingMembershipId, m!._id),
			"overlapping start refused at creation",
		);
		const today = await post(
			server.baseUrl,
			saleBody({ userId: String(inv.userId), locationId: String(B) }),
		);
		assert(today.status === 201, "no start date: created (checked on payment)");
		const todayId = today.data.invoice._id ?? today.data.invoice.id;
		const refused = await fetchJson(
			server.baseUrl,
			`/invoices/${todayId}/status`,
			{
				method: "PATCH",
				token: desk,
				body: { paymentStatus: "PAID" },
			},
		);
		assert(
			refused.status === 409 && refused.data.code === "MEMBERSHIP_OVERLAP",
			"overlap refused on PAID",
		);
		assert(
			(await Invoice.findById(todayId))?.paymentStatus !== "PAID",
			"invoice left unpaid",
		);

		console.log("\n— payment-time fallback for an invoice with only a lead");
		const oldLead = await Lead.create({
			leadName: "Ravi",
			phone: "9000000002",
			locationId: A,
		});
		const legacy = await Invoice.create({
			invoiceNumber: "LEGACY-1",
			leadId: oldLead._id,
			locationId: A,
			items: [{ name: "Monthly", price: 2000, quantity: 1 }],
			subtotal: 2000,
			total: 2000,
			planSnapshot: {
				name: "Monthly",
				durationInDays: 30,
				price: 2000,
				includedCredits: 0,
			},
		});
		const legacyPaid = await fetchJson(
			server.baseUrl,
			`/invoices/${legacy._id}/status`,
			{
				method: "PATCH",
				token: desk,
				body: { paymentStatus: "PAID" },
			},
		);
		assert(
			legacyPaid.status === 200,
			`no more "convert the lead first" (${legacyPaid.status})`,
		);
		const legacyM = await Membership.findOne({ invoiceId: legacy._id });
		assert(
			legacyM?.status === MembershipStatus.Active,
			"today's start → Active",
		);

		console.log("\n— B5 Upcoming flips to Active when it starts");
		await Membership.updateOne(
			{ _id: m!._id },
			{ startDate: new Date(Date.now() - 1000) },
		);
		await activateDueMemberships();
		assert(
			(await Membership.findById(m!._id))?.status === MembershipStatus.Active,
			"activated",
		);

		console.log("\n— B9 manual membership is admin-only with a reason");
		const manual = {
			userId: String(inv.userId),
			planName: "Comp",
			price: 0,
			startDate: new Date(Date.now() + 400 * 86_400_000).toISOString(),
			locationId: String(A),
		};
		const asDesk = await fetchJson(server.baseUrl, "/memberships", {
			method: "POST",
			token: desk,
			body: { ...manual, reason: "x" },
		});
		assert(asDesk.status === 403, "frontdesk refused");
		const noReason = await fetchJson(server.baseUrl, "/memberships", {
			method: "POST",
			token: admin,
			body: manual,
		});
		assert(noReason.status === 400, "reason required");
		const clash = await fetchJson(server.baseUrl, "/memberships", {
			method: "POST",
			token: admin,
			body: { ...manual, startDate: new Date().toISOString(), reason: "Comp" },
		});
		assert(
			clash.status === 409 && clash.data.code === "MEMBERSHIP_OVERLAP",
			"manual overlap refused",
		);
		const ok = await fetchJson(server.baseUrl, "/memberships", {
			method: "POST",
			token: admin,
			body: { ...manual, reason: "Staff comp" },
		});
		assert(ok.status === 201, `manual created (${ok.status})`);
		assert(
			ok.data.membership.status === MembershipStatus.Upcoming &&
				ok.data.membership.manualReason === "Staff comp",
			"future manual → Upcoming, reason stored",
		);

		console.log("\n🎉 New sale tests passed");
	} finally {
		await server.close();
		await mongoose.disconnect();
	}
}

run().then(
	() => process.exit(0),
	(err) => {
		console.error("New sale test failed:", err);
		process.exit(1);
	},
);
