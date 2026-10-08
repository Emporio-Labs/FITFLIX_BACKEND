import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Lead from "../src/models/Lead";
import Location from "../src/models/Location";
import { LeadStatus } from "../src/models/Enums";
import { clearStaffContextCache } from "../src/services/staffContext.service";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

/**
 * FX-33 — sales staff claim leads from their branch's queue.
 *
 * Exercises the real router + branch-scope wiring with STAFF_RBAC_ENFORCE on:
 *   - FX-33.1 a created lead is stamped with its branch.
 *   - FX-33.2 a claim records the claimer's name + time (and mirrors owner).
 *   - FX-33.3 two simultaneous claims → exactly one 200, one 409.
 *   - FX-33.4 sales see unclaimed + own; a manager sees every lead at the branch.
 *   - FX-33.5 a note / contact attempt / conversion is attributed to the actor.
 * Plus the branch guard (a lead at another branch is refused) and the flag-off
 * rollback (no ownership narrowing).
 */
async function runFx33Tests() {
	console.log("=== Feature Test: FX-33 Lead Claim Queue ===");
	const { baseUrl, close } = await startTestServer();

	const suffix = Date.now();
	const branchA = await Location.create({
		name: "FX33 Branch A",
		code: `fx33-a-${suffix}`,
	});
	const branchB = await Location.create({
		name: "FX33 Branch B",
		code: `fx33-b-${suffix}`,
	});

	const makeAdmin = async (name: string, staffRole: string | null) => {
		const id = new mongoose.Types.ObjectId();
		await Admin.create({
			_id: id,
			adminName: name,
			email: `fx33-${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}@fitflix.test`,
			phone: "9000000000",
			passwordHash: "x",
			staffRole,
			branchIds: staffRole ? [branchA._id] : [],
			allBranches: staffRole === null,
			status: "active",
		});
		return id;
	};

	const salesId = await makeAdmin("Sales One", "sales");
	const otherSalesId = await makeAdmin("Sales Two", "sales");
	const managerId = await makeAdmin("Branch Manager", "manager");
	const globalAdminId = await makeAdmin("Global Admin", null);

	const salesToken = generateTestToken("admin", salesId.toString());
	const otherSalesToken = generateTestToken("admin", otherSalesId.toString());
	const managerToken = generateTestToken("admin", managerId.toString());
	const adminToken = generateTestToken("admin", globalAdminId.toString());

	const seedLead = (
		leadName: string,
		locationId: mongoose.Types.ObjectId,
		claimedBy?: mongoose.Types.ObjectId,
	) =>
		Lead.create({
			leadName,
			phone: `98${Math.floor(Math.random() * 100000000)}`,
			status: LeadStatus.New,
			locationId,
			...(claimedBy
				? { claimedBy, claimedByName: "seed", claimedAt: new Date() }
				: {}),
		});

	const cleanup = async () => {
		await Promise.all([
			Admin.deleteMany({
				_id: { $in: [salesId, otherSalesId, managerId, globalAdminId] },
			}),
			Lead.deleteMany({ locationId: { $in: [branchA._id, branchB._id] } }),
			Location.deleteMany({ code: { $regex: `^fx33-.*-${suffix}$` } }),
		]);
	};

	try {
		process.env.STAFF_RBAC_ENFORCE = "true";
		clearStaffContextCache();

		// ── FX-33.1 ──────────────────────────────────────────────────────────
		console.log("\n1. FX-33.1 — a new lead is stamped with its branch");
		const created = await fetchJson(baseUrl, "/leads", {
			token: adminToken,
			method: "POST",
			body: { leadName: "Stamped Lead", phone: "9811111111", locationId: branchA._id.toString() },
		});
		assert(
			created.status === 201 &&
				String(created.data?.lead?.locationId) === branchA._id.toString(),
			`Created lead carries its branch (got ${created.status}/${created.data?.lead?.locationId})`,
		);

		// ── FX-33.2 ──────────────────────────────────────────────────────────
		console.log("\n2. FX-33.2 — claiming records the claimer's name + time");
		const toClaim = await seedLead("Claim Me", branchA._id);
		clearStaffContextCache();
		const claim = await fetchJson(baseUrl, `/leads/${toClaim._id}/claim`, {
			token: salesToken,
			method: "POST",
		});
		assert(
			claim.status === 200 &&
				String(claim.data?.lead?.claimedBy) === salesId.toString() &&
				claim.data?.lead?.claimedByName === "Sales One" &&
				!!claim.data?.lead?.claimedAt,
			`Claim stamps claimedBy/name/at (got ${claim.status}/${claim.data?.lead?.claimedByName})`,
		);
		assert(
			String(claim.data?.lead?.owner) === salesId.toString() &&
				claim.data?.lead?.assignedStaffName === "Sales One",
			"Claim mirrors into owner / assignedStaffName for the existing UI column",
		);

		// ── FX-33.3 ──────────────────────────────────────────────────────────
		console.log("\n3. FX-33.3 — simultaneous claims: one wins, one is told it's taken");
		const contested = await seedLead("Contested", branchA._id);
		clearStaffContextCache();
		const [r1, r2] = await Promise.all([
			fetchJson(baseUrl, `/leads/${contested._id}/claim`, { token: salesToken, method: "POST" }),
			fetchJson(baseUrl, `/leads/${contested._id}/claim`, { token: otherSalesToken, method: "POST" }),
		]);
		const statuses = [r1.status, r2.status].sort();
		assert(
			statuses[0] === 200 && statuses[1] === 409,
			`Exactly one claim succeeds, the other gets 409 (got ${statuses.join("/")})`,
		);
		const loser = r1.status === 409 ? r1 : r2;
		assert(
			typeof loser.data?.details?.claimedByName === "string" &&
				loser.data.details.claimedByName.length > 0,
			"The loser is told who claimed it",
		);

		// ── FX-33.4 ──────────────────────────────────────────────────────────
		console.log("\n4. FX-33.4 — sales see unclaimed + own; manager sees all at branch");
		const unclaimed = await seedLead("Unclaimed Queue", branchA._id);
		const ownedBySales = await seedLead("Owned By Sales", branchA._id, salesId);
		const ownedByOther = await seedLead("Owned By Other", branchA._id, otherSalesId);
		clearStaffContextCache();

		const salesList = await fetchJson(baseUrl, "/leads", { token: salesToken });
		const salesIds = (salesList.data?.leads ?? []).map((l: any) => String(l._id));
		assert(
			salesIds.includes(String(unclaimed._id)) &&
				salesIds.includes(String(ownedBySales._id)) &&
				!salesIds.includes(String(ownedByOther._id)),
			`Sales sees unclaimed + own, not another sales rep's lead (count ${salesIds.length})`,
		);

		const managerList = await fetchJson(baseUrl, "/leads", { token: managerToken });
		const managerIds = (managerList.data?.leads ?? []).map((l: any) => String(l._id));
		assert(
			managerIds.includes(String(unclaimed._id)) &&
				managerIds.includes(String(ownedBySales._id)) &&
				managerIds.includes(String(ownedByOther._id)),
			`Manager sees every lead at the branch (count ${managerIds.length})`,
		);

		// ── Branch guard ───────────────────────────────────────────────────────
		console.log("\n5. Branch guard — sales can't claim a lead from another branch");
		const foreignLead = await seedLead("Other Branch", branchB._id);
		clearStaffContextCache();
		const foreignClaim = await fetchJson(baseUrl, `/leads/${foreignLead._id}/claim`, {
			token: salesToken,
			method: "POST",
		});
		assert(
			foreignClaim.status === 403 && foreignClaim.data?.code === "NOT_YOUR_BRANCH",
			`Claiming another branch's lead is refused 403 NOT_YOUR_BRANCH (got ${foreignClaim.status}/${foreignClaim.data?.code})`,
		);

		// ── FX-33.5 ──────────────────────────────────────────────────────────
		console.log("\n6. FX-33.5 — notes / calls / conversion are attributed to the actor");
		const worked = await seedLead("Worked Lead", branchA._id, salesId);
		clearStaffContextCache();
		const noted = await fetchJson(baseUrl, `/leads/${worked._id}/interactions`, {
			token: salesToken,
			method: "POST",
			body: { note: "Left a voicemail", type: "note" },
		});
		const lastNote = (noted.data?.lead?.interactions ?? []).slice(-1)[0];
		assert(
			noted.status === 201 &&
				String(lastNote?.createdBy) === salesId.toString() &&
				lastNote?.createdByName === "Sales One",
			`Note records createdBy = the acting staff member (got ${noted.status}/${lastNote?.createdByName})`,
		);

		const attempt = await fetchJson(baseUrl, `/leads/${worked._id}/contact-attempt`, {
			token: salesToken,
			method: "POST",
			body: { channel: "call" },
		});
		assert(
			attempt.status === 201 && (attempt.data?.lead?.contactCount ?? 0) >= 1,
			`Contact attempt is logged and counted (got ${attempt.status}/${attempt.data?.lead?.contactCount})`,
		);

		const converted = await fetchJson(baseUrl, `/leads/${worked._id}/convert`, {
			token: managerToken,
			method: "POST",
			body: { phone: "9822222222", age: "30", gender: "Male", healthGoals: ["general fitness"] },
		});
		assert(
			(converted.status === 201 || converted.status === 200) &&
				String(converted.data?.lead?.convertedBy) === managerId.toString(),
			`Conversion is attributed to the actor, incl. a manager (got ${converted.status}/${converted.data?.lead?.convertedBy})`,
		);

		// ── Flag off ─────────────────────────────────────────────────────────
		console.log("\n7. Flag off — no ownership narrowing (today's behaviour)");
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		const offList = await fetchJson(baseUrl, "/leads", { token: salesToken });
		const offIds = (offList.data?.leads ?? []).map((l: any) => String(l._id));
		assert(
			offIds.includes(String(ownedByOther._id)),
			"Flag off: a sales caller sees every lead again (including others' claimed)",
		);

		console.log("\n🎉 FX-33 Lead Claim Queue Tests Passed!");
	} finally {
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		await cleanup();
		await close();
	}
}

runFx33Tests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("FX-33 lead-claim test failed:", err);
		process.exit(1);
	});
