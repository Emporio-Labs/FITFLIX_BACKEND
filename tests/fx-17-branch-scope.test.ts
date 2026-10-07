import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Location from "../src/models/Location";
import Trainer from "../src/models/Trainer";
import { clearStaffContextCache } from "../src/services/staffContext.service";
import { assert, fetchJson, generateTestToken, startTestServer } from "./test-helpers";

/**
 * FX-17 — every staff request is checked against the branch it is for.
 *
 * Exercises the real middleware + router wiring with STAFF_RBAC_ENFORCE toggled
 * per case. A trainer scoped to branch A must be refused on branch B, refused on
 * an inactive branch, allowed on A; a global admin is allowed anywhere; a
 * front-desk token is refused on an admin-only route; with the flag off every
 * check is a no-op; and a branch change takes effect once the cache is cleared.
 */
async function runFx17Tests() {
	console.log("=== Feature Test: FX-17 Branch-Scoped Staff RBAC ===");
	const { baseUrl, close } = await startTestServer();

	const suffix = Date.now();
	const branchA = await Location.create({ name: "Branch A", code: `fx17-a-${suffix}` });
	const branchB = await Location.create({ name: "Branch B", code: `fx17-b-${suffix}` });
	const branchC = await Location.create({
		name: "Branch C (inactive)",
		code: `fx17-c-${suffix}`,
		isActive: false,
	});

	const trainerId = new mongoose.Types.ObjectId();
	await Trainer.create({
		_id: trainerId,
		trainerName: "Scoped Coach",
		email: `fx17-trainer-${suffix}@fitflix.test`,
		phone: "9999999999",
		passwordHash: "x", // unused — we auth with a generated token
		branchIds: [branchA._id],
		isActive: true,
	});
	const trainerToken = generateTestToken("trainer", trainerId.toString());

	const adminId = new mongoose.Types.ObjectId();
	await Admin.create({
		_id: adminId,
		adminName: "Global Admin",
		email: `fx17-admin-${suffix}@fitflix.test`,
		phone: "8888888888",
		passwordHash: "x",
	});
	const adminToken = generateTestToken("admin", adminId.toString());

	const frontDeskToken = generateTestToken(
		"ROLE_FRONT_DESK_STAFF",
		new mongoose.Types.ObjectId().toString(),
	);

	const patchTrainer = (token: string, locationId: string) =>
		fetchJson(baseUrl, `/trainers/${trainerId.toString()}`, {
			token,
			method: "PATCH",
			body: { trainerName: "Scoped Coach", locationId },
		});

	const cleanup = async () => {
		await Promise.all([
			Trainer.deleteOne({ _id: trainerId }),
			Admin.deleteOne({ _id: adminId }),
			Location.deleteMany({ code: { $regex: `^fx17-.*-${suffix}$` } }),
		]);
	};

	try {
		// ── Flag ON ──────────────────────────────────────────────────────────
		process.env.STAFF_RBAC_ENFORCE = "true";
		clearStaffContextCache();

		console.log("\n1. FX-17.1 — staff refused on a branch they don't work at");
		const foreign = await patchTrainer(trainerToken, branchB._id.toString());
		assert(
			foreign.status === 403 && foreign.data?.code === "NOT_YOUR_BRANCH",
			`Trainer acting on branch B is refused 403 NOT_YOUR_BRANCH (got ${foreign.status}/${foreign.data?.code})`,
		);

		console.log("\n2. FX-17.2 — deactivated branch refused with a clear code");
		const inactive = await patchTrainer(trainerToken, branchC._id.toString());
		assert(
			inactive.status === 400 && inactive.data?.code === "LOCATION_INACTIVE",
			`Inactive branch is refused 400 LOCATION_INACTIVE (got ${inactive.status}/${inactive.data?.code})`,
		);

		console.log("\n   FX-17.2 — an invalid branch id is refused too");
		const invalid = await patchTrainer(trainerToken, "not-an-object-id");
		assert(
			invalid.status === 400 && invalid.data?.code === "INVALID_LOCATION_ID",
			`Invalid branch id is refused 400 INVALID_LOCATION_ID (got ${invalid.status}/${invalid.data?.code})`,
		);

		console.log("\n3. FX-17.1 — staff allowed on their own branch");
		const own = await patchTrainer(trainerToken, branchA._id.toString());
		assert(own.status === 200, `Trainer acting on branch A succeeds (got ${own.status})`);

		console.log("\n4. FX-17.4 — a global admin may act on any branch");
		clearStaffContextCache();
		const adminAnywhere = await patchTrainer(adminToken, branchB._id.toString());
		assert(
			adminAnywhere.status === 200,
			`Admin acting on branch B succeeds (got ${adminAnywhere.status})`,
		);

		console.log("\n5. FX-17.7 — front-desk staff refused on an admin-only route");
		const fdAdmin = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: frontDeskToken,
			method: "POST",
			body: { name: "nope", creditCost: 1 },
		});
		assert(
			fdAdmin.status === 403,
			`Front-desk POST to an admin route is refused 403 (got ${fdAdmin.status})`,
		);

		console.log("\n6. FX-17.5 — a branch change takes effect after the cache clears");
		await Trainer.updateOne({ _id: trainerId }, { $set: { branchIds: [branchB._id] } });
		clearStaffContextCache(trainerId.toString());
		const movedAllowed = await patchTrainer(trainerToken, branchB._id.toString());
		assert(
			movedAllowed.status === 200,
			`After reassignment to branch B, acting on B succeeds (got ${movedAllowed.status})`,
		);
		clearStaffContextCache(trainerId.toString());
		const movedRefused = await patchTrainer(trainerToken, branchA._id.toString());
		assert(
			movedRefused.status === 403 && movedRefused.data?.code === "NOT_YOUR_BRANCH",
			`After reassignment, old branch A is now refused (got ${movedRefused.status}/${movedRefused.data?.code})`,
		);

		// ── Flag OFF ─────────────────────────────────────────────────────────
		console.log("\n7. FX-17.6 — with the switch off, enforcement is a no-op");
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		const offForeign = await patchTrainer(trainerToken, branchA._id.toString());
		assert(
			offForeign.status === 200,
			`Flag off: trainer acting on any branch is allowed (got ${offForeign.status})`,
		);
		const offFrontDesk = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: frontDeskToken,
			method: "POST",
			body: { name: "legacy", creditCost: 1 },
		});
		assert(
			offFrontDesk.status !== 403,
			`Flag off: front-desk keeps legacy admin treatment (not 403, got ${offFrontDesk.status})`,
		);

		console.log("\n🎉 FX-17 Branch-Scoped Staff RBAC Tests Passed!");
	} finally {
		process.env.STAFF_RBAC_ENFORCE = "false";
		clearStaffContextCache();
		await cleanup();
		await close();
	}
}

runFx17Tests().catch((err) => {
	console.error("FX-17 branch-scope test failed:", err);
	process.exit(1);
});
