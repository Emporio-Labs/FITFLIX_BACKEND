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
 * FX-34 — managers reassign or take back leads.
 *
 * Builds on the FX-33 claim queue. Exercises the real router + branch-scope
 * wiring with STAFF_RBAC_ENFORCE on:
 *   - FX-34.1 a manager reassigns a branch lead to another person, or releases
 *     it back to the unclaimed queue.
 *   - FX-34.2 the reassignment is recorded in the lead's history (a `system`
 *     interaction naming from → to, attributed to the actor).
 *   - FX-34.3 a sales person can't reassign to someone else, and can only
 *     release a lead they currently hold.
 *   - FX-34.4 the team-performance view reports each person's open leads,
 *     conversions and average time to first contact.
 * Plus the branch guard on the assignee (can't hand a lead to someone who
 * doesn't work at that branch).
 */
async function runFx34Tests() {
	console.log("=== Feature Test: FX-34 Lead Reassignment ===");
	const { baseUrl, close } = await startTestServer();

	const suffix = Date.now();
	const branchA = await Location.create({
		name: "FX34 Branch A",
		code: `fx34-a-${suffix}`,
	});
	const branchB = await Location.create({
		name: "FX34 Branch B",
		code: `fx34-b-${suffix}`,
	});

	const makeAdmin = async (
		name: string,
		staffRole: string | null,
		branch = branchA._id,
	) => {
		const id = new mongoose.Types.ObjectId();
		await Admin.create({
			_id: id,
			adminName: name,
			email: `fx34-${name.toLowerCase().replace(/\s+/g, "-")}-${suffix}@fitflix.test`,
			phone: "9000000000",
			passwordHash: "x",
			staffRole,
			branchIds: staffRole ? [branch] : [],
			allBranches: staffRole === null,
			status: "active",
		});
		return id;
	};

	const salesId = await makeAdmin("Sales One", "sales");
	const otherSalesId = await makeAdmin("Sales Two", "sales");
	const branchBSalesId = await makeAdmin("Sales Three", "sales", branchB._id);
	const managerId = await makeAdmin("Branch Manager", "manager");
	const globalAdminId = await makeAdmin("Global Admin", null);

	const salesToken = generateTestToken("admin", salesId.toString());
	const managerToken = generateTestToken("admin", managerId.toString());

	const seedLead = (
		leadName: string,
		locationId: mongoose.Types.ObjectId,
		claimedBy?: mongoose.Types.ObjectId,
		claimedByName = "seed",
		extra: Record<string, unknown> = {},
	) =>
		Lead.create({
			leadName,
			phone: `98${Math.floor(Math.random() * 100000000)}`,
			status: LeadStatus.New,
			locationId,
			...(claimedBy
				? { claimedBy, claimedByName, claimedAt: new Date() }
				: {}),
			...extra,
		});

	const cleanup = async () => {
		await Promise.all([
			Admin.deleteMany({
				_id: {
					$in: [
						salesId,
						otherSalesId,
						branchBSalesId,
						managerId,
						globalAdminId,
					],
				},
			}),
			Lead.deleteMany({ locationId: { $in: [branchA._id, branchB._id] } }),
			Location.deleteMany({ code: { $regex: `^fx34-.*-${suffix}$` } }),
		]);
	};

	try {
		process.env.STAFF_RBAC_ENFORCE = "true";
		clearStaffContextCache();

		// ── FX-34.1 + FX-34.2 ────────────────────────────────────────────────
		console.log("\n1. FX-34.1 — a manager reassigns a sales lead to another person");
		const owned = await seedLead("Owned By Sales", branchA._id, salesId, "Sales One");
		clearStaffContextCache();
		const reassigned = await fetchJson(baseUrl, `/leads/${owned._id}/reassign`, {
			token: managerToken,
			method: "POST",
			body: { assigneeId: otherSalesId.toString() },
		});
		assert(
			reassigned.status === 200 &&
				String(reassigned.data?.lead?.claimedBy) === otherSalesId.toString() &&
				reassigned.data?.lead?.claimedByName === "Sales Two" &&
				String(reassigned.data?.lead?.owner) === otherSalesId.toString() &&
				reassigned.data?.lead?.assignedStaffName === "Sales Two",
			`Reassign moves claimedBy/owner/assignedStaffName to the new person (got ${reassigned.status}/${reassigned.data?.lead?.claimedByName})`,
		);

		console.log("\n2. FX-34.2 — the reassignment shows in the lead's history");
		const lastInteraction = (reassigned.data?.lead?.interactions ?? []).slice(-1)[0];
		assert(
			lastInteraction?.type === "system" &&
				typeof lastInteraction?.note === "string" &&
				lastInteraction.note.includes("Sales One") &&
				lastInteraction.note.includes("Sales Two") &&
				lastInteraction?.createdByName === "Branch Manager",
			`History records from → to and who did it (got "${lastInteraction?.note}" by ${lastInteraction?.createdByName})`,
		);

		// ── Release to the queue ─────────────────────────────────────────────
		console.log("\n3. FX-34.1 — a manager releases a lead back to the unclaimed queue");
		const toRelease = await seedLead("Release Me", branchA._id, salesId, "Sales One");
		clearStaffContextCache();
		const released = await fetchJson(baseUrl, `/leads/${toRelease._id}/reassign`, {
			token: managerToken,
			method: "POST",
			body: { assigneeId: null },
		});
		assert(
			released.status === 200 &&
				released.data?.lead?.claimedBy == null &&
				released.data?.lead?.claimedByName === "" &&
				released.data?.lead?.assignedStaffName === "",
			`Release clears the claim back to the queue (got ${released.status}/${released.data?.lead?.claimedBy})`,
		);

		// ── FX-34.3 ──────────────────────────────────────────────────────────
		console.log("\n4. FX-34.3 — a sales person can't reassign a lead to someone else");
		const salesOwned = await seedLead("Sales Owns This", branchA._id, salesId, "Sales One");
		clearStaffContextCache();
		const salesReassign = await fetchJson(baseUrl, `/leads/${salesOwned._id}/reassign`, {
			token: salesToken,
			method: "POST",
			body: { assigneeId: otherSalesId.toString() },
		});
		assert(
			salesReassign.status === 403 && salesReassign.data?.code === "FORBIDDEN_REASSIGN",
			`Sales reassigning to another person is refused 403 (got ${salesReassign.status}/${salesReassign.data?.code})`,
		);

		console.log("\n5. FX-34.3 — a sales person CAN release their own lead to the queue");
		clearStaffContextCache();
		const salesRelease = await fetchJson(baseUrl, `/leads/${salesOwned._id}/reassign`, {
			token: salesToken,
			method: "POST",
			body: {},
		});
		assert(
			salesRelease.status === 200 && salesRelease.data?.lead?.claimedBy == null,
			`Sales releasing their own lead succeeds (got ${salesRelease.status}/${salesRelease.data?.lead?.claimedBy})`,
		);

		console.log("\n6. FX-34.3 — a sales person can't release a lead they don't hold");
		const othersLead = await seedLead("Owned By Other", branchA._id, otherSalesId, "Sales Two");
		clearStaffContextCache();
		const salesReleaseOther = await fetchJson(baseUrl, `/leads/${othersLead._id}/reassign`, {
			token: salesToken,
			method: "POST",
			body: {},
		});
		assert(
			salesReleaseOther.status === 403 && salesReleaseOther.data?.code === "FORBIDDEN_RELEASE",
			`Sales releasing someone else's lead is refused 403 (got ${salesReleaseOther.status}/${salesReleaseOther.data?.code})`,
		);

		// ── Assignee branch guard ────────────────────────────────────────────
		console.log("\n7. A manager can't reassign to staff at a different branch");
		const branchLead = await seedLead("Branch A Lead", branchA._id, salesId, "Sales One");
		clearStaffContextCache();
		const wrongBranch = await fetchJson(baseUrl, `/leads/${branchLead._id}/reassign`, {
			token: managerToken,
			method: "POST",
			body: { assigneeId: branchBSalesId.toString() },
		});
		assert(
			wrongBranch.status === 400 && wrongBranch.data?.code === "ASSIGNEE_NOT_AT_BRANCH",
			`Reassigning to another branch's staff is refused 400 (got ${wrongBranch.status}/${wrongBranch.data?.code})`,
		);

		// ── FX-34.4 ──────────────────────────────────────────────────────────
		console.log("\n8. FX-34.4 — team performance: open leads, conversions, avg time to first contact");
		// Sales One: one open lead contacted 2h after claim, one converted lead.
		const claimedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const firstContactAt = new Date(claimedAt.getTime() + 2 * 60 * 60 * 1000);
		await seedLead("Perf Open", branchA._id, salesId, "Sales One", {
			status: LeadStatus.Contacted,
			claimedAt,
			interactions: [
				{
					type: "call",
					note: "Called",
					createdBy: salesId,
					createdByName: "Sales One",
					createdAt: firstContactAt,
				},
			],
		});
		await seedLead("Perf Converted", branchA._id, salesId, "Sales One", {
			status: LeadStatus.Converted,
			claimedAt,
		});
		clearStaffContextCache();

		const perf = await fetchJson(baseUrl, "/leads/team-performance", {
			token: managerToken,
		});
		const salesRow = (perf.data?.members ?? []).find(
			(m: any) => String(m.staffId) === salesId.toString(),
		);
		assert(
			perf.status === 200 && !!salesRow,
			`Team performance returns a row for the sales person (got ${perf.status})`,
		);
		assert(
			salesRow.openLeads >= 1 && salesRow.conversions >= 1,
			`Row reports open leads and conversions (open ${salesRow?.openLeads}, conv ${salesRow?.conversions})`,
		);
		const twoHoursMs = 2 * 60 * 60 * 1000;
		assert(
			typeof salesRow.avgTimeToFirstContactMs === "number" &&
				Math.abs(salesRow.avgTimeToFirstContactMs - twoHoursMs) < 60 * 1000,
			`Avg time to first contact ≈ 2h (got ${salesRow?.avgTimeToFirstContactMs}ms)`,
		);

		console.log("\n🎉 FX-34 Lead Reassignment Tests Passed!");
	} finally {
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		await cleanup();
		await close();
	}
}

runFx34Tests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("FX-34 lead-reassign test failed:", err);
		process.exit(1);
	});
