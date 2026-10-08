import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Booking from "../src/models/Bookings";
import { Gender, MembershipStatus } from "../src/models/Enums";
import GymVisit from "../src/models/GymVisit";
import Invoice from "../src/models/Invoice";
import Location from "../src/models/Location";
import Membership from "../src/models/Membership";
import User from "../src/models/User";
import { clearStaffContextCache } from "../src/services/staffContext.service";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

/**
 * FX-18 — staff only see their own branch's data.
 *
 * Exercises the real routers + branch-scope wiring with STAFF_RBAC_ENFORCE on:
 *   - FX-18.1 a branch-scoped staffer sees no member / membership / invoice /
 *     booking / visit from another branch in any list, and their dashboard
 *     metrics count only their branch.
 *   - FX-18.2 opening another branch's record directly by id returns 404.
 *   - FX-18.4 a member's own-data reads are never branch-gated.
 * Plus: a global admin sees every branch, and the flag-off path is unscoped.
 */
async function runFx18Tests() {
	console.log("=== Feature Test: FX-18 Branch Read Scope ===");
	const { baseUrl, close } = await startTestServer();

	const suffix = Date.now();
	const branchA = await Location.create({
		name: "FX18 Branch A",
		code: `fx18-a-${suffix}`,
	});
	const branchB = await Location.create({
		name: "FX18 Branch B",
		code: `fx18-b-${suffix}`,
	});

	// A branch-scoped Admin (manager at branch A). Its JWT role is "admin" (so it
	// clears the authorize() lists), but resolveStaffContext re-derives scope
	// "branch" from staffRole + branchIds — exactly how a real scoped staffer logs
	// in. A global admin (staffRole null) acts on every branch.
	const scopedAdminId = new mongoose.Types.ObjectId();
	const globalAdminId = new mongoose.Types.ObjectId();
	await Admin.create({
		_id: scopedAdminId,
		adminName: "FX18 Branch Manager",
		email: `fx18-scoped-${suffix}@fitflix.test`,
		phone: "9000000000",
		passwordHash: "x",
		staffRole: "manager",
		branchIds: [branchA._id],
		allBranches: false,
		status: "active",
	});
	await Admin.create({
		_id: globalAdminId,
		adminName: "FX18 Global Admin",
		email: `fx18-global-${suffix}@fitflix.test`,
		phone: "9000000001",
		passwordHash: "x",
		staffRole: null,
		allBranches: true,
		status: "active",
	});
	const scopedToken = generateTestToken("admin", scopedAdminId.toString());
	const globalToken = generateTestToken("admin", globalAdminId.toString());

	const makeMember = (name: string, branch: mongoose.Types.ObjectId) =>
		User.create({
			username: name,
			phone: `98${Math.floor(Math.random() * 100000000)}`,
			email: `${name}-${suffix}@fitflix.test`,
			age: 30,
			gender: Gender.Male,
			homeLocationId: branch,
		});

	// Branch A: two members, one active membership, an invoice, a booking, visits.
	const memberA1 = await makeMember("fx18MemberA1", branchA._id);
	const memberA2 = await makeMember("fx18MemberA2", branchA._id);
	const memberB1 = await makeMember("fx18MemberB1", branchB._id);

	const makeMembership = (
		user: mongoose.Types.ObjectId,
		branch: mongoose.Types.ObjectId,
	) =>
		Membership.create({
			user,
			planName: `FX18 Plan ${suffix}`,
			price: 1000,
			startDate: new Date(),
			status: MembershipStatus.Active,
			locationId: branch,
		});
	const membershipA = await makeMembership(memberA1._id, branchA._id);
	const membershipB = await makeMembership(memberB1._id, branchB._id);

	const makeInvoice = (
		user: mongoose.Types.ObjectId,
		branch: mongoose.Types.ObjectId,
		tag: string,
	) =>
		Invoice.create({
			invoiceNumber: `FX18-${tag}-${suffix}`,
			userId: user,
			items: [{ name: "Plan", price: 1000, quantity: 1 }],
			subtotal: 1000,
			total: 1000,
			planSnapshot: {
				name: "FX18 Plan",
				durationInDays: 30,
				price: 1000,
				includedCredits: 10,
			},
			locationId: branch,
		});
	const invoiceA = await makeInvoice(memberA1._id, branchA._id, "a");
	const invoiceB = await makeInvoice(memberB1._id, branchB._id, "b");

	const makeBooking = (
		user: mongoose.Types.ObjectId,
		branch: mongoose.Types.ObjectId,
	) =>
		Booking.create({
			bookingDate: new Date(),
			startTime: "10:00",
			endTime: "11:00",
			user,
			locationId: branch,
			creditCostSnapshot: 1,
			creditsBypassed: false,
		});
	const bookingA = await makeBooking(memberA1._id, branchA._id);
	const bookingB = await makeBooking(memberB1._id, branchB._id);

	await GymVisit.create({ userId: memberA1._id, locationId: branchA._id, checkInAt: new Date() });
	await GymVisit.create({ userId: memberA2._id, locationId: branchA._id, checkInAt: new Date() });
	await GymVisit.create({ userId: memberB1._id, locationId: branchB._id, checkInAt: new Date() });

	const memberToken = generateTestToken("user", memberA1._id.toString());

	const idStr = (x: any) => String(x?._id ?? x?.id ?? "");

	const cleanup = async () => {
		await Promise.all([
			Admin.deleteMany({ _id: { $in: [scopedAdminId, globalAdminId] } }),
			User.deleteMany({ _id: { $in: [memberA1._id, memberA2._id, memberB1._id] } }),
			Membership.deleteMany({ _id: { $in: [membershipA._id, membershipB._id] } }),
			Invoice.deleteMany({ _id: { $in: [invoiceA._id, invoiceB._id] } }),
			Booking.deleteMany({ _id: { $in: [bookingA._id, bookingB._id] } }),
			GymVisit.deleteMany({ locationId: { $in: [branchA._id, branchB._id] } }),
			Location.deleteMany({ code: { $regex: `^fx18-.*-${suffix}$` } }),
		]);
	};

	try {
		process.env.STAFF_RBAC_ENFORCE = "true";
		clearStaffContextCache();

		// ── FX-18.1 — list scoping ───────────────────────────────────────────────
		console.log("\n1. FX-18.1 — a branch-scoped staffer only sees their branch's data");

		const users = await fetchJson(baseUrl, "/users", { token: scopedToken });
		const userIds = (users.data?.users ?? []).map(idStr);
		assert(
			userIds.includes(memberA1._id.toString()) &&
				!userIds.includes(memberB1._id.toString()),
			`Members list is branch-scoped (A in, B out) — got ${userIds.length} rows`,
		);

		const memberships = await fetchJson(baseUrl, "/memberships", { token: scopedToken });
		const membershipIds = (memberships.data?.memberships ?? []).map(idStr);
		assert(
			membershipIds.includes(membershipA._id.toString()) &&
				!membershipIds.includes(membershipB._id.toString()),
			"Memberships list is branch-scoped (A in, B out)",
		);

		const invoices = await fetchJson(baseUrl, "/invoices", { token: scopedToken });
		const invoiceIds = (invoices.data?.invoices ?? []).map(idStr);
		assert(
			invoiceIds.includes(invoiceA._id.toString()) &&
				!invoiceIds.includes(invoiceB._id.toString()),
			"Invoices list is branch-scoped (A in, B out)",
		);

		const bookings = await fetchJson(baseUrl, "/bookings", { token: scopedToken });
		const bookingIds = (bookings.data?.bookings ?? []).map(idStr);
		assert(
			bookingIds.includes(bookingA._id.toString()) &&
				!bookingIds.includes(bookingB._id.toString()),
			"Bookings list is branch-scoped (A in, B out)",
		);

		const visits = await fetchJson(baseUrl, "/gym-visits", { token: scopedToken });
		assert(
			visits.data?.total === 2,
			`Visits list is branch-scoped — branch A total only (got ${visits.data?.total})`,
		);

		// Dashboard metrics: branchA is a brand-new location, so only our seeded
		// rows reference it — the counts are deterministic.
		const metrics = await fetchJson(baseUrl, "/dashboard/metrics", { token: scopedToken });
		assert(
			metrics.data?.users?.totalCount === 2,
			`Dashboard member count is branch-scoped (got ${metrics.data?.users?.totalCount})`,
		);
		assert(
			metrics.data?.memberships?.activeCount === 1,
			`Dashboard active-membership count is branch-scoped (got ${metrics.data?.memberships?.activeCount})`,
		);

		// ── FX-18.2 — direct by-id access to another branch → 404 ────────────────
		console.log("\n2. FX-18.2 — another branch's record opens as 'not found'");
		const userB = await fetchJson(baseUrl, `/users/${memberB1._id}`, { token: scopedToken });
		assert(userB.status === 404, `GET another branch's member → 404 (got ${userB.status})`);
		const memB = await fetchJson(baseUrl, `/memberships/${membershipB._id}`, { token: scopedToken });
		assert(memB.status === 404, `GET another branch's membership → 404 (got ${memB.status})`);
		const invB = await fetchJson(baseUrl, `/invoices/${invoiceB._id}`, { token: scopedToken });
		assert(invB.status === 404, `GET another branch's invoice → 404 (got ${invB.status})`);
		const bkB = await fetchJson(baseUrl, `/bookings/${bookingB._id}`, { token: scopedToken });
		assert(bkB.status === 404, `GET another branch's booking → 404 (got ${bkB.status})`);
		// Positive control: the staffer's own branch record is reachable.
		const userA = await fetchJson(baseUrl, `/users/${memberA1._id}`, { token: scopedToken });
		assert(userA.status === 200, `GET own branch's member → 200 (got ${userA.status})`);

		// ── FX-18.4 — members book/browse as before ──────────────────────────────
		console.log("\n3. FX-18.4 — a member's own-data reads are never branch-gated");
		const myProfile = await fetchJson(baseUrl, "/users/me", { token: memberToken });
		assert(myProfile.status === 200, `Member reads their own profile (got ${myProfile.status})`);
		const myBookings = await fetchJson(baseUrl, "/bookings/me", { token: memberToken });
		assert(myBookings.status === 200, `Member reads their own bookings (got ${myBookings.status})`);

		// ── Global admin — every branch ──────────────────────────────────────────
		console.log("\n4. A global admin sees every branch");
		const allUsers = await fetchJson(baseUrl, "/users", { token: globalToken });
		const allUserIds = (allUsers.data?.users ?? []).map(idStr);
		assert(
			allUserIds.includes(memberA1._id.toString()) &&
				allUserIds.includes(memberB1._id.toString()),
			"Global admin's members list spans both branches",
		);
		const allInvB = await fetchJson(baseUrl, `/invoices/${invoiceB._id}`, { token: globalToken });
		assert(allInvB.status === 200, `Global admin opens any branch's invoice (got ${allInvB.status})`);

		// ── Flag off — unscoped (today's behaviour) ──────────────────────────────
		console.log("\n5. Flag off — scoping is a no-op");
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		const offUsers = await fetchJson(baseUrl, "/users", { token: scopedToken });
		const offIds = (offUsers.data?.users ?? []).map(idStr);
		assert(
			offIds.includes(memberB1._id.toString()),
			"Flag off: the scoped caller sees other branches again",
		);
		const offBkB = await fetchJson(baseUrl, `/bookings/${bookingB._id}`, { token: scopedToken });
		assert(offBkB.status === 200, `Flag off: another branch's booking is reachable (got ${offBkB.status})`);

		console.log("\n🎉 FX-18 Branch Read Scope Tests Passed!");
	} finally {
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		await cleanup();
		await close();
	}
}

runFx18Tests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("FX-18 branch-read-scope test failed:", err);
		process.exit(1);
	});
