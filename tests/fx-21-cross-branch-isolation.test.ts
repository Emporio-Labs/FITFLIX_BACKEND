import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Booking from "../src/models/Bookings";
import { Gender, MembershipStatus } from "../src/models/Enums";
import GymVisit from "../src/models/GymVisit";
import Invoice from "../src/models/Invoice";
import Lead from "../src/models/Lead";
import Location from "../src/models/Location";
import Membership from "../src/models/Membership";
import Slot from "../src/models/Slots";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import { clearStaffContextCache } from "../src/services/staffContext.service";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

/**
 * FX-21 — cross-branch access is blocked, proven by tests (US-QA-01, work-plan S10).
 *
 * The acceptance evidence a second branch can't open without: an automated suite
 * that stands up TWO fully-populated branches and proves, from both sides, that a
 * branch-scoped staff account can never reach the other branch's data — in any
 * list, on any record page, or by hand-editing the branch a request names.
 *
 *   FX-21.1  Two branches (A and B) each get staff, members, bookings, invoices,
 *            memberships, leads, slots and visits. A global admin sees all of it,
 *            which is how we know both branches are really seeded.
 *   FX-21.2  For every staff list and record page, a branch-A account gets
 *            "not your branch" or nothing for branch B's data — and, symmetrically,
 *            a branch-B account gets nothing for branch A's. Record pages answer
 *            404 (never 403), so existence can't even be confirmed.
 *   FX-21.3  The suite also tries the branch-id attacks:
 *              • a forged branch   — a fabricated-but-valid id for no real branch,
 *              • an invalid branch — a malformed id,
 *              • a deactivated branch,
 *              • a real other branch (the direct "edit the request" attack),
 *            plus a sign-in from before FX-16 — a staff session whose account was
 *            never assigned a branch — which must resolve to NOTHING, not a bypass.
 *   FX-21.4  Runs from the release checklist (`bun run test:fx-21`); all green.
 *   FX-21.5  One-page summary lives in docs/qa/FX-21-cross-branch-isolation.md.
 *
 * Mechanism under test: `STAFF_RBAC_ENFORCE` on, the real routers + `staffGuard`
 * (attachStaffContext + enforceBranchScope) + the controllers' scopedLocationFilter
 * / isBranchInScope read gates. Branch-scoped "manager" Admin accounts log in with
 * JWT role "admin" (so they clear every authorize() list) while resolveStaffContext
 * re-derives their branch scope from the DB — exactly how a real scoped staffer
 * behaves. With the flag off the whole thing is a no-op (the rollback), asserted at
 * the end.
 */
async function runFx21Tests() {
	console.log("=== Feature Test: FX-21 Cross-Branch Access Blocked ===");
	const { baseUrl, close } = await startTestServer();

	const suffix = Date.now();

	// ── Branches ────────────────────────────────────────────────────────────
	// A and B are active and fully populated. C is deactivated (for the
	// LOCATION_INACTIVE case). `forgedBranchId` is a syntactically valid ObjectId
	// that is never saved — a "forged" branch that resolves to no real location.
	const branchA = await Location.create({
		name: "FX21 Branch A",
		code: `fx21-a-${suffix}`,
	});
	const branchB = await Location.create({
		name: "FX21 Branch B",
		code: `fx21-b-${suffix}`,
	});
	const branchC = await Location.create({
		name: "FX21 Branch C (inactive)",
		code: `fx21-c-${suffix}`,
		isActive: false,
	});
	const forgedBranchId = new mongoose.Types.ObjectId();

	// ── Staff ─────────────────────────────────────────────────────────────────
	// Two branch-scoped managers (one per branch) + a global admin + a legacy
	// "pre-FX-16" staffer who was never assigned a branch.
	const managerAId = new mongoose.Types.ObjectId();
	const managerBId = new mongoose.Types.ObjectId();
	const globalAdminId = new mongoose.Types.ObjectId();
	const legacyStaffId = new mongoose.Types.ObjectId();

	await Admin.create({
		_id: managerAId,
		adminName: "FX21 Manager A",
		email: `fx21-mgrA-${suffix}@fitflix.test`,
		phone: "9100000000",
		passwordHash: "x",
		staffRole: "manager",
		branchIds: [branchA._id],
		allBranches: false,
		status: "active",
	});
	await Admin.create({
		_id: managerBId,
		adminName: "FX21 Manager B",
		email: `fx21-mgrB-${suffix}@fitflix.test`,
		phone: "9100000001",
		passwordHash: "x",
		staffRole: "manager",
		branchIds: [branchB._id],
		allBranches: false,
		status: "active",
	});
	await Admin.create({
		_id: globalAdminId,
		adminName: "FX21 Global Admin",
		email: `fx21-global-${suffix}@fitflix.test`,
		phone: "9100000002",
		passwordHash: "x",
		staffRole: null,
		allBranches: true,
		status: "active",
	});
	// Pre-FX-16 sign-in: a real staff account (front-desk) that predates branch
	// assignment — no branchIds, allBranches false. Its token is valid (as a
	// 240-day token minted before FX-16 would still be), but authority is
	// re-derived from the DB, so an unassigned account can act on nothing.
	await Admin.create({
		_id: legacyStaffId,
		adminName: "FX21 Legacy Staff",
		email: `fx21-legacy-${suffix}@fitflix.test`,
		phone: "9100000003",
		passwordHash: "x",
		staffRole: "frontdesk",
		branchIds: [],
		allBranches: false,
		status: "active",
	});

	const mgrAToken = generateTestToken("admin", managerAId.toString());
	const mgrBToken = generateTestToken("admin", managerBId.toString());
	const globalToken = generateTestToken("admin", globalAdminId.toString());
	const legacyToken = generateTestToken("admin", legacyStaffId.toString());

	// A coach at each branch — the per-branch "staff roster" (trainers list is
	// branch-scoped on locationId) and the target for the write-side attacks.
	const trainerAId = new mongoose.Types.ObjectId();
	const trainerBId = new mongoose.Types.ObjectId();
	await Trainer.create({
		_id: trainerAId,
		trainerName: "FX21 Coach A",
		email: `fx21-coachA-${suffix}@fitflix.test`,
		phone: "9200000000",
		passwordHash: "x",
		locationId: branchA._id,
		branchIds: [branchA._id],
		isActive: true,
	});
	await Trainer.create({
		_id: trainerBId,
		trainerName: "FX21 Coach B",
		email: `fx21-coachB-${suffix}@fitflix.test`,
		phone: "9200000001",
		passwordHash: "x",
		locationId: branchB._id,
		branchIds: [branchB._id],
		isActive: true,
	});

	// ── Members (homeLocationId carries a member's branch) ─────────────────────
	const makeMember = (name: string, branch: mongoose.Types.ObjectId) =>
		User.create({
			username: name,
			phone: `97${Math.floor(Math.random() * 100000000)}`,
			email: `${name}-${suffix}@fitflix.test`,
			age: 30,
			gender: Gender.Male,
			homeLocationId: branch,
		});
	const memberA1 = await makeMember("fx21MemberA1", branchA._id);
	const memberA2 = await makeMember("fx21MemberA2", branchA._id);
	const memberB1 = await makeMember("fx21MemberB1", branchB._id);
	const memberB2 = await makeMember("fx21MemberB2", branchB._id);

	// ── Memberships ─────────────────────────────────────────────────────────
	const makeMembership = (
		user: mongoose.Types.ObjectId,
		branch: mongoose.Types.ObjectId,
	) =>
		Membership.create({
			user,
			planName: `FX21 Plan ${suffix}`,
			price: 1000,
			startDate: new Date(),
			status: MembershipStatus.Active,
			locationId: branch,
		});
	const membershipA = await makeMembership(memberA1._id, branchA._id);
	const membershipB = await makeMembership(memberB1._id, branchB._id);

	// ── Invoices ────────────────────────────────────────────────────────────
	const makeInvoice = (
		user: mongoose.Types.ObjectId,
		branch: mongoose.Types.ObjectId,
		tag: string,
	) =>
		Invoice.create({
			invoiceNumber: `FX21-${tag}-${suffix}`,
			userId: user,
			items: [{ name: "Plan", price: 1000, quantity: 1 }],
			subtotal: 1000,
			total: 1000,
			planSnapshot: {
				name: "FX21 Plan",
				durationInDays: 30,
				price: 1000,
				includedCredits: 10,
			},
			locationId: branch,
		});
	const invoiceA = await makeInvoice(memberA1._id, branchA._id, "a");
	const invoiceB = await makeInvoice(memberB1._id, branchB._id, "b");

	// ── Bookings ──────────────────────────────────────────────────────────────
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

	// ── Visits ────────────────────────────────────────────────────────────────
	// Distinct per-branch counts (A=2, B=1) so any cross-branch leak shows up as a
	// wrong total, not just a wrong row.
	await GymVisit.create({ userId: memberA1._id, locationId: branchA._id, checkInAt: new Date() });
	await GymVisit.create({ userId: memberA2._id, locationId: branchA._id, checkInAt: new Date() });
	await GymVisit.create({ userId: memberB1._id, locationId: branchB._id, checkInAt: new Date() });

	// ── Leads ─────────────────────────────────────────────────────────────────
	const leadA = await Lead.create({
		leadName: "FX21 Lead A",
		email: `fx21-leadA-${suffix}@fitflix.test`,
		phone: "9300000000",
		locationId: branchA._id,
	});
	const leadB = await Lead.create({
		leadName: "FX21 Lead B",
		email: `fx21-leadB-${suffix}@fitflix.test`,
		phone: "9300000001",
		locationId: branchB._id,
	});

	// ── Slots (templates: date null / isDaily, so they survive the list window) ─
	const slotA = await Slot.create({
		locationId: branchA._id,
		date: null,
		isDaily: true,
		startTime: "07:00",
		endTime: "08:00",
		capacity: 5,
		remainingCapacity: 5,
	});
	const slotB = await Slot.create({
		locationId: branchB._id,
		date: null,
		isDaily: true,
		startTime: "07:00",
		endTime: "08:00",
		capacity: 5,
		remainingCapacity: 5,
	});

	const idStr = (x: any) => String(x?._id ?? x?.id ?? "");
	const aId = memberA1._id.toString();
	const bId = memberB1._id.toString();

	const cleanup = async () => {
		await Promise.all([
			Admin.deleteMany({
				_id: { $in: [managerAId, managerBId, globalAdminId, legacyStaffId] },
			}),
			Trainer.deleteMany({ _id: { $in: [trainerAId, trainerBId] } }),
			User.deleteMany({
				_id: { $in: [memberA1._id, memberA2._id, memberB1._id, memberB2._id] },
			}),
			Membership.deleteMany({ _id: { $in: [membershipA._id, membershipB._id] } }),
			Invoice.deleteMany({ _id: { $in: [invoiceA._id, invoiceB._id] } }),
			Booking.deleteMany({ _id: { $in: [bookingA._id, bookingB._id] } }),
			GymVisit.deleteMany({ locationId: { $in: [branchA._id, branchB._id] } }),
			Lead.deleteMany({ _id: { $in: [leadA._id, leadB._id] } }),
			Slot.deleteMany({ _id: { $in: [slotA._id, slotB._id] } }),
			Location.deleteMany({ code: { $regex: `^fx21-.*-${suffix}$` } }),
		]);
	};

	// Pull a staffer's view of each branch-scoped list, as id arrays / totals.
	const listView = async (token: string) => {
		const [
			users,
			memberships,
			invoices,
			bookings,
			visits,
			leads,
			trainers,
			slots,
		] = await Promise.all([
			fetchJson(baseUrl, "/users", { token }),
			fetchJson(baseUrl, "/memberships", { token }),
			fetchJson(baseUrl, "/invoices", { token }),
			fetchJson(baseUrl, "/bookings", { token }),
			fetchJson(baseUrl, "/gym-visits", { token }),
			fetchJson(baseUrl, "/leads", { token }),
			fetchJson(baseUrl, "/trainers", { token }),
			fetchJson(baseUrl, "/slots", { token }),
		]);
		return {
			userIds: (users.data?.users ?? []).map(idStr),
			membershipIds: (memberships.data?.memberships ?? []).map(idStr),
			invoiceIds: (invoices.data?.invoices ?? []).map(idStr),
			bookingIds: (bookings.data?.bookings ?? []).map(idStr),
			visitTotal: visits.data?.total,
			leadIds: (leads.data?.leads ?? []).map(idStr),
			trainerIds: (trainers.data?.trainers ?? []).map(idStr),
			slotIds: (slots.data?.slots ?? []).map(idStr),
		};
	};

	try {
		process.env.STAFF_RBAC_ENFORCE = "true";
		clearStaffContextCache();

		// ── FX-21.1 — both branches are really populated (global admin sees all) ──
		console.log("\n1. FX-21.1 — two branches, each fully seeded (global admin sees both)");
		const all = await listView(globalToken);
		assert(
			all.userIds.includes(aId) && all.userIds.includes(bId),
			"Global admin's members span both branches",
		);
		assert(
			all.membershipIds.includes(membershipA._id.toString()) &&
				all.membershipIds.includes(membershipB._id.toString()),
			"Global admin's memberships span both branches",
		);
		assert(
			all.invoiceIds.includes(invoiceA._id.toString()) &&
				all.invoiceIds.includes(invoiceB._id.toString()),
			"Global admin's invoices span both branches",
		);
		assert(
			all.bookingIds.includes(bookingA._id.toString()) &&
				all.bookingIds.includes(bookingB._id.toString()),
			"Global admin's bookings span both branches",
		);
		assert(
			all.leadIds.includes(leadA._id.toString()) &&
				all.leadIds.includes(leadB._id.toString()),
			"Global admin's leads span both branches",
		);
		assert(
			all.trainerIds.includes(trainerAId.toString()) &&
				all.trainerIds.includes(trainerBId.toString()),
			"Global admin's trainer roster spans both branches",
		);
		assert(
			all.slotIds.includes(slotA._id.toString()) &&
				all.slotIds.includes(slotB._id.toString()),
			"Global admin's slots span both branches",
		);
		// Global admin's list spans the whole DB, so assert it covers at least our
		// two branches' seeded visits (A=2 + B=1) rather than an absolute count —
		// a copy-of-production run will carry other branches' visits too.
		assert(
			typeof all.visitTotal === "number" && all.visitTotal >= 3,
			`Global admin's visit total covers both branches (got ${all.visitTotal}, expected ≥ 3)`,
		);

		// ── FX-21.2 — branch A account gets nothing for branch B, in every list ───
		console.log("\n2. FX-21.2 — branch-A staff see only branch A in every list");
		const aView = await listView(mgrAToken);
		assert(
			aView.userIds.includes(aId) && !aView.userIds.includes(bId),
			`Members list: A in, B out (got ${aView.userIds.length} rows)`,
		);
		assert(
			aView.membershipIds.includes(membershipA._id.toString()) &&
				!aView.membershipIds.includes(membershipB._id.toString()),
			"Memberships list: A in, B out",
		);
		assert(
			aView.invoiceIds.includes(invoiceA._id.toString()) &&
				!aView.invoiceIds.includes(invoiceB._id.toString()),
			"Invoices list: A in, B out",
		);
		assert(
			aView.bookingIds.includes(bookingA._id.toString()) &&
				!aView.bookingIds.includes(bookingB._id.toString()),
			"Bookings list: A in, B out",
		);
		assert(
			aView.leadIds.includes(leadA._id.toString()) &&
				!aView.leadIds.includes(leadB._id.toString()),
			"Leads list: A in, B out",
		);
		assert(
			aView.trainerIds.includes(trainerAId.toString()) &&
				!aView.trainerIds.includes(trainerBId.toString()),
			"Trainer roster: A in, B out",
		);
		assert(
			aView.slotIds.includes(slotA._id.toString()) &&
				!aView.slotIds.includes(slotB._id.toString()),
			"Slots list: A in, B out",
		);
		assert(
			aView.visitTotal === 2,
			`Visits list: branch A total only (got ${aView.visitTotal})`,
		);

		// Dashboard metrics count only the caller's branch.
		const aMetrics = await fetchJson(baseUrl, "/dashboard/metrics", { token: mgrAToken });
		assert(
			aMetrics.data?.users?.totalCount === 2,
			`Dashboard members scoped to A (got ${aMetrics.data?.users?.totalCount}, all-branches would be 4)`,
		);
		assert(
			aMetrics.data?.memberships?.activeCount === 1,
			`Dashboard active memberships scoped to A (got ${aMetrics.data?.memberships?.activeCount})`,
		);

		// ── FX-21.2 (symmetry) — branch B account gets nothing for branch A ───────
		console.log("\n3. FX-21.2 — the mirror holds: branch-B staff see only branch B");
		const bView = await listView(mgrBToken);
		assert(
			bView.userIds.includes(bId) && !bView.userIds.includes(aId),
			"Members list (B account): B in, A out",
		);
		assert(
			bView.invoiceIds.includes(invoiceB._id.toString()) &&
				!bView.invoiceIds.includes(invoiceA._id.toString()),
			"Invoices list (B account): B in, A out",
		);
		assert(
			bView.bookingIds.includes(bookingB._id.toString()) &&
				!bView.bookingIds.includes(bookingA._id.toString()),
			"Bookings list (B account): B in, A out",
		);
		assert(
			bView.leadIds.includes(leadB._id.toString()) &&
				!bView.leadIds.includes(leadA._id.toString()),
			"Leads list (B account): B in, A out",
		);
		assert(
			bView.visitTotal === 1,
			`Visits list (B account): branch B total only (got ${bView.visitTotal})`,
		);

		// ── FX-21.2 — record pages: another branch's record is 404, never 403 ────
		console.log("\n4. FX-21.2 — record pages: another branch's record reads as 404");
		const recordChecks: Array<[string, string]> = [
			[`/users/${bId}`, "member"],
			[`/memberships/${membershipB._id}`, "membership"],
			[`/invoices/${invoiceB._id}`, "invoice"],
			[`/bookings/${bookingB._id}`, "booking"],
		];
		for (const [path, label] of recordChecks) {
			const res = await fetchJson(baseUrl, path, { token: mgrAToken });
			assert(
				res.status === 404,
				`A opening B's ${label} by id → 404 (got ${res.status})`,
			);
		}
		// Mirror: B opening A's records is equally a 404.
		const bOpensA = await fetchJson(baseUrl, `/invoices/${invoiceA._id}`, { token: mgrBToken });
		assert(bOpensA.status === 404, `B opening A's invoice by id → 404 (got ${bOpensA.status})`);
		// Positive control: A can open its own records.
		const aOwnUser = await fetchJson(baseUrl, `/users/${aId}`, { token: mgrAToken });
		assert(aOwnUser.status === 200, `A opening its own member → 200 (got ${aOwnUser.status})`);
		const aOwnInvoice = await fetchJson(baseUrl, `/invoices/${invoiceA._id}`, { token: mgrAToken });
		assert(aOwnInvoice.status === 200, `A opening its own invoice → 200 (got ${aOwnInvoice.status})`);

		// ── FX-21.3 — branch-id attacks on a write (PATCH /trainers/:id) ─────────
		console.log("\n5. FX-21.3 — forged / invalid / deactivated / other-branch writes are refused");
		const patchTrainerBranch = (token: string, locationId: string) =>
			fetchJson(baseUrl, `/trainers/${trainerAId.toString()}`, {
				token,
				method: "PATCH",
				body: { trainerName: "FX21 Coach A", locationId },
			});

		// (a) a real OTHER branch — the direct "edit the request to point at B" attack
		const otherBranch = await patchTrainerBranch(mgrAToken, branchB._id.toString());
		assert(
			otherBranch.status === 403 && otherBranch.data?.code === "NOT_YOUR_BRANCH",
			`Write naming branch B → 403 NOT_YOUR_BRANCH (got ${otherBranch.status}/${otherBranch.data?.code})`,
		);

		// (b) a forged branch — a valid ObjectId that is no real location
		const forged = await patchTrainerBranch(mgrAToken, forgedBranchId.toString());
		assert(
			forged.status === 404 && forged.data?.code === "LOCATION_NOT_FOUND",
			`Write naming a forged branch → 404 LOCATION_NOT_FOUND (got ${forged.status}/${forged.data?.code})`,
		);

		// (c) an invalid branch — a malformed id
		const invalid = await patchTrainerBranch(mgrAToken, "not-an-object-id");
		assert(
			invalid.status === 400 && invalid.data?.code === "INVALID_LOCATION_ID",
			`Write naming an invalid branch → 400 INVALID_LOCATION_ID (got ${invalid.status}/${invalid.data?.code})`,
		);

		// (d) a deactivated branch
		const inactive = await patchTrainerBranch(mgrAToken, branchC._id.toString());
		assert(
			inactive.status === 400 && inactive.data?.code === "LOCATION_INACTIVE",
			`Write naming a deactivated branch → 400 LOCATION_INACTIVE (got ${inactive.status}/${inactive.data?.code})`,
		);

		// Positive control: naming the caller's OWN branch on a write succeeds.
		const ownBranch = await patchTrainerBranch(mgrAToken, branchA._id.toString());
		assert(ownBranch.status === 200, `Write naming own branch A → 200 (got ${ownBranch.status})`);

		// ── FX-21.3 — the same attacks on a READ can't widen past the caller's branch
		console.log("\n6. FX-21.3 — spoofing ?locationId on a read never leaks another branch");
		// Forged/other branch id as an explicit read scope → matches nothing, not B.
		const spoofForged = await fetchJson(baseUrl, `/users?locationId=${forgedBranchId.toString()}`, { token: mgrAToken });
		const spoofForgedIds = (spoofForged.data?.users ?? []).map(idStr);
		assert(
			!spoofForgedIds.includes(aId) && !spoofForgedIds.includes(bId),
			`?locationId=<forged> narrows to nothing, not B (got ${spoofForgedIds.length} rows)`,
		);
		const spoofOther = await fetchJson(baseUrl, `/bookings?locationId=${branchB._id.toString()}`, { token: mgrAToken });
		const spoofOtherIds = (spoofOther.data?.bookings ?? []).map(idStr);
		assert(
			!spoofOtherIds.includes(bookingB._id.toString()),
			"?locationId=<branch B> from an A account returns no B bookings",
		);
		// A malformed id is ignored (not a 400 on a read) and falls back to own scope.
		const spoofInvalid = await fetchJson(baseUrl, "/users?locationId=not-an-object-id", { token: mgrAToken });
		const spoofInvalidIds = (spoofInvalid.data?.users ?? []).map(idStr);
		assert(
			spoofInvalid.status === 200 &&
				spoofInvalidIds.includes(aId) &&
				!spoofInvalidIds.includes(bId),
			"?locationId=<malformed> falls back to the caller's own branch (A in, B out)",
		);

		// ── FX-21.3 — a sign-in from before FX-16 resolves to NOTHING ─────────────
		console.log("\n7. FX-21.3 — a pre-FX-16 sign-in (no branch assigned) can act on nothing");
		const legacyView = await listView(legacyToken);
		assert(
			!legacyView.userIds.includes(aId) && !legacyView.userIds.includes(bId),
			"Legacy staffer's members list is empty of both branches",
		);
		assert(
			!legacyView.invoiceIds.includes(invoiceA._id.toString()) &&
				!legacyView.invoiceIds.includes(invoiceB._id.toString()),
			"Legacy staffer's invoices list is empty of both branches",
		);
		assert(
			!legacyView.bookingIds.includes(bookingA._id.toString()) &&
				!legacyView.bookingIds.includes(bookingB._id.toString()),
			"Legacy staffer's bookings list is empty of both branches",
		);
		assert(
			!legacyView.membershipIds.includes(membershipA._id.toString()) &&
				!legacyView.membershipIds.includes(membershipB._id.toString()),
			"Legacy staffer's memberships list is empty of both branches",
		);
		assert(
			legacyView.visitTotal === 0,
			`Legacy staffer's visit total is 0 (got ${legacyView.visitTotal})`,
		);
		const legacyUser = await fetchJson(baseUrl, `/users/${aId}`, { token: legacyToken });
		assert(legacyUser.status === 404, `Legacy staffer opening a member by id → 404 (got ${legacyUser.status})`);
		const legacyInvoice = await fetchJson(baseUrl, `/invoices/${invoiceA._id}`, { token: legacyToken });
		assert(legacyInvoice.status === 404, `Legacy staffer opening an invoice by id → 404 (got ${legacyInvoice.status})`);

		// ── Rollback — with the switch off, scoping is a no-op ────────────────────
		console.log("\n8. FX-21 rollback — flag off restores today's cross-branch behaviour");
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		const offView = await listView(mgrAToken);
		assert(
			offView.userIds.includes(aId) && offView.userIds.includes(bId),
			"Flag off: the scoped A account sees branch B members again",
		);
		const offInvoiceB = await fetchJson(baseUrl, `/invoices/${invoiceB._id}`, { token: mgrAToken });
		assert(
			offInvoiceB.status === 200,
			`Flag off: another branch's invoice is reachable again (got ${offInvoiceB.status})`,
		);

		console.log("\n🎉 FX-21 Cross-Branch Access Blocked — all assertions passed!");
	} finally {
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		await cleanup();
		await close();
	}
}

runFx21Tests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("FX-21 cross-branch isolation test failed:", err);
		process.exit(1);
	});
