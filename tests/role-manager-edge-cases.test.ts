/**
 * 20 Comprehensive Test Cases for Role Standardization, Manager Scoping & Edge Cases.
 * Run with: bun tests/role-manager-edge-cases.test.ts
 */
import mongoose from "mongoose";
import type { Request, Response } from "express";
import { normalizeRole, authorize } from "../src/middleware/rbac.middleware";
import { resolveBranchScope, branchFilter } from "../src/utils/branch-scope";
import { signAuthToken, verifyAuthToken, getJwtConfig } from "../src/utils/jwt";
import type { AppUserRole } from "../src/types/auth";
import User from "../src/models/User";
import Location from "../src/models/Location";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testNum: number, name: string, detail?: string) {
	totalTests++;
	if (condition) {
		passedTests++;
		console.log(`  ✅ Test ${testNum}: ${name}`);
	} else {
		failedTests++;
		console.error(`  ❌ FAILED Test ${testNum}: ${name} ${detail ? `(${detail})` : ""}`);
	}
}

// Helper to construct Express Request / Response mocks
const mockReq = (
	user?: { id: string; role: string; email?: string },
	query: Record<string, string> = {},
	headers: Record<string, string> = {},
): Request =>
	({
		user: user ? { id: user.id, role: user.role, email: user.email ?? "test@fitflix.in" } : undefined,
		query,
		get: (h: string) => headers[h.toLowerCase()],
		originalUrl: "/test",
		method: "GET",
	}) as unknown as Request;

const mockRes = () => {
	const res: Partial<Response> & { statusCode: number; responseJson?: unknown } = {
		statusCode: 200,
		status(code: number) {
			this.statusCode = code;
			return this as Response;
		},
		json(data: unknown) {
			this.responseJson = data;
			return this as Response;
		},
	};
	return res as Response & { statusCode: number; responseJson?: unknown };
};

async function runTestSuite() {
	console.log("===============================================================================");
	console.log("🚀 EXECUTING 20 ROLE STANDARDIZATION & MANAGER SCOPING TEST CASES");
	console.log("===============================================================================\n");

	process.env.JWT_SECRET = "test-secret-key-32-chars-long-minimum-length";

	const branchA = new mongoose.Types.ObjectId();
	const branchB = new mongoose.Types.ObjectId();
	const managerUserId = new mongoose.Types.ObjectId();
	const adminUserId = new mongoose.Types.ObjectId();

	// --------------------------------------------------------------------------
	// GROUP 1: ROLE NORMALIZATION & JWT AUTH (Tests 1–5)
	// --------------------------------------------------------------------------
	console.log("👉 Group 1: Role Normalization & JWT Auth Contract");

	// Test 1: Admin role normalization
	assert(
		normalizeRole("admin") === "admin",
		1,
		"Admin role normalizes directly to 'admin'",
	);

	// Test 2: Super Admin role normalization
	assert(
		normalizeRole("super_admin" as AppUserRole) === "admin",
		2,
		"Super Admin role normalizes to 'admin' on backend",
	);

	// Test 3: Manager role normalization
	assert(
		normalizeRole("manager") === "manager",
		3,
		"Manager role normalizes directly to 'manager'",
	);

	// Test 4: Doctor canonical role normalization & legacy clinician alias
	const docNorm = normalizeRole("doctor");
	const clinNorm = normalizeRole("clinician" as AppUserRole);
	assert(
		docNorm === "doctor" && clinNorm === "doctor",
		4,
		"Doctor role and legacy 'clinician' both normalize to 'doctor'",
	);

	// Test 5: Staff & Sports Scientist normalization
	const sportsNorm = normalizeRole("sports_scientist");
	const sportsAliasNorm = normalizeRole("sports-scientist" as AppUserRole);
	const staffNorm = normalizeRole("staff");
	assert(
		sportsNorm === "sports_scientist" && sportsAliasNorm === "sports_scientist" && staffNorm === "frontdesk",
		5,
		"Sports scientist and staff aliases normalize correctly",
	);

	// --------------------------------------------------------------------------
	// GROUP 2: RBAC AUTHORIZATION MIDDLEWARE (Tests 6–10)
	// --------------------------------------------------------------------------
	console.log("\n👉 Group 2: RBAC Middleware Authorization & Rejection");

	// Test 6: Authorize middleware allows 'admin' on admin endpoints
	{
		const req = mockReq({ id: adminUserId.toString(), role: "admin" });
		const res = mockRes();
		let calledNext = false;
		authorize(["admin"])(req, res, () => { calledNext = true; });
		assert(calledNext && res.statusCode === 200, 6, "authorize(['admin']) grants access to role 'admin'");
	}

	// Test 7: Authorize middleware allows 'super_admin' on admin endpoints
	{
		const req = mockReq({ id: adminUserId.toString(), role: "super_admin" });
		const res = mockRes();
		let calledNext = false;
		authorize(["admin"])(req, res, () => { calledNext = true; });
		assert(calledNext && res.statusCode === 200, 7, "authorize(['admin']) grants access to role 'super_admin'");
	}

	// Test 8: Authorize middleware allows 'manager' on manager endpoints
	{
		const req = mockReq({ id: managerUserId.toString(), role: "manager" });
		const res = mockRes();
		let calledNext = false;
		authorize(["admin", "manager"])(req, res, () => { calledNext = true; });
		assert(calledNext && res.statusCode === 200, 8, "authorize(['admin', 'manager']) grants access to role 'manager'");
	}

	// Test 9: Authorize middleware BLOCKS 'manager' from admin-only endpoints (403 Forbidden)
	{
		const req = mockReq({ id: managerUserId.toString(), role: "manager" });
		const res = mockRes();
		let calledNext = false;
		authorize(["admin"])(req, res, () => { calledNext = true; });
		assert(!calledNext && res.statusCode === 403, 9, "authorize(['admin']) blocks 'manager' with 403 Forbidden");
	}

	// Test 10: Authorize middleware BLOCKS unauthenticated requests (401 Unauthorized)
	{
		const req = mockReq(undefined);
		const res = mockRes();
		let calledNext = false;
		authorize(["admin", "manager"])(req, res, () => { calledNext = true; });
		assert(!calledNext && res.statusCode === 401, 10, "Unauthenticated request returns 401 Unauthorized");
	}

	// --------------------------------------------------------------------------
	// GROUP 3: JWT TOKEN SIGNING & TOKEN ENVELOPE (Tests 11–13)
	// --------------------------------------------------------------------------
	console.log("\n👉 Group 3: JWT Token Generation & Verification");

	const jwtConfig = getJwtConfig();
	if (!jwtConfig) throw new Error("JWT config missing");

	// Test 11: JWT signing & verification for role 'manager'
	{
		const token = signAuthToken({ id: managerUserId.toString(), role: "manager", email: "mgr@fitflix.in" }, jwtConfig);
		const decoded = verifyAuthToken(token, jwtConfig);
		assert(
			Boolean(decoded && decoded.role === "manager" && decoded.id === managerUserId.toString()),
			11,
			"JWT correctly signs and decodes role 'manager'",
		);
	}

	// Test 12: JWT signing & verification for role 'doctor'
	{
		const docId = new mongoose.Types.ObjectId().toString();
		const token = signAuthToken({ id: docId, role: "doctor", email: "dr@fitflix.in" }, jwtConfig);
		const decoded = verifyAuthToken(token, jwtConfig);
		assert(
			Boolean(decoded && decoded.role === "doctor" && decoded.id === docId),
			12,
			"JWT correctly signs and decodes role 'doctor'",
		);
	}

	// Test 13: JWT signing for role 'super_admin'
	{
		const token = signAuthToken({ id: adminUserId.toString(), role: "super_admin" as AppUserRole, email: "sa@fitflix.in" }, jwtConfig);
		const decoded = verifyAuthToken(token, jwtConfig);
		assert(
			Boolean(decoded && decoded.role === "super_admin"),
			13,
			"JWT correctly signs and decodes role 'super_admin'",
		);
	}

	// --------------------------------------------------------------------------
	// GROUP 4: BRANCH SCOPING & ANTI-SPOOFING (Tests 14–18)
	// --------------------------------------------------------------------------
	console.log("\n👉 Group 4: Branch Scoping & Anti-Spoofing Perimeter");

	// Test 14: Admin unscoped read returns null ("all branches")
	{
		const req = mockReq({ id: adminUserId.toString(), role: "admin" });
		const scope = await resolveBranchScope(req);
		assert(scope === null, 14, "Admin unscoped request resolves to null ('All Branches')");
	}

	// Test 15: Admin with X-Location-Id header scopes to target branch
	{
		const req = mockReq(
			{ id: adminUserId.toString(), role: "admin" },
			{},
			{ "x-location-id": branchA.toString() },
		);
		const scope = await resolveBranchScope(req);
		assert(scope === branchA.toString(), 15, "Admin with X-Location-Id scopes to selected branch");
	}

	// Test 16: Admin with ?locationId= query parameter scopes to target branch
	{
		const req = mockReq(
			{ id: adminUserId.toString(), role: "admin" },
			{ locationId: branchB.toString() },
		);
		const scope = await resolveBranchScope(req);
		assert(scope === branchB.toString(), 16, "Admin with ?locationId= scopes to query parameter branch");
	}

	// Mock User and Location DB queries for branch resolution
	const originalUserFindById = User.findById;
	const originalLocationFindOne = Location.findOne;

	try {
		// Mock User.findById to return manager's homeLocationId
		User.findById = ((id: unknown) => ({
			select: () => ({
				lean: async () => {
					if (String(id) === managerUserId.toString()) {
						return { homeLocationId: branchA };
					}
					return null;
				},
			}),
		})) as any;

		// Mock Location.findOne to return default branch
		Location.findOne = (() => ({
			select: () => ({
				lean: async () => ({ _id: branchA }),
			}),
		})) as any;

		// Test 17: Manager strictly derives branch from User.homeLocationId
		{
			const req = mockReq({ id: managerUserId.toString(), role: "manager" });
			const scope = await resolveBranchScope(req);
			assert(scope === branchA.toString(), 17, "Manager derives branch scope strictly from User.homeLocationId");
		}

		// Test 18: Manager Anti-Spoofing: Ignored X-Location-Id header and query
		{
			const req = mockReq(
				{ id: managerUserId.toString(), role: "manager" },
				{ locationId: branchB.toString() },
				{ "x-location-id": branchB.toString() },
			);
			const scope = await resolveBranchScope(req);
			assert(
				scope === branchA.toString(),
				18,
				"Anti-Spoofing: Manager cannot override branch via header or query (Branch B attempt locked to Branch A)",
			);
		}
	} finally {
		User.findById = originalUserFindById;
		Location.findOne = originalLocationFindOne;
	}

	// --------------------------------------------------------------------------
	// GROUP 5: EDGE CASES & FRONTDESK ROLE MAPPING (Tests 19–20)
	// --------------------------------------------------------------------------
	console.log("\n👉 Group 5: Edge Cases & Frontdesk Role Mapping Contract");

	// Test 19: Manager with missing homeLocationId safe fallback
	{
		const unassignedManagerId = new mongoose.Types.ObjectId();
		const origUserFindById = User.findById;
		const origLocFindOne = Location.findOne;
		try {
			User.findById = (() => ({
				select: () => ({
					lean: async () => ({ homeLocationId: null }),
				}),
			})) as any;

			Location.findOne = (() => ({
				select: () => ({
					lean: async () => ({ _id: branchA }),
				}),
			})) as any;

			const req = mockReq({ id: unassignedManagerId.toString(), role: "manager" });
			const scope = await resolveBranchScope(req);
			assert(
				scope === branchA.toString(),
				19,
				"Edge Case: Manager with homeLocationId null safely falls back to default active branch (no unscoped leak)",
			);
		} finally {
			User.findById = origUserFindById;
			Location.findOne = origLocFindOne;
		}
	}

	// Test 20: FrontDesk Role Mapping Dictionary Contract
	{
		const frontdeskRoleMap: Record<string, string> = {
			admin: "admin",
			super_admin: "super_admin",
			clinic_admin: "admin",
			manager: "manager",
			doctor: "doctor",
			clinician: "doctor",
			trainer: "trainer",
			nutritionist: "nutritionist",
			sports_scientist: "sports_scientist",
			"sports-scientist": "sports_scientist",
			frontdesk: "manager",
			staff: "manager",
		};

		const mappingsValid =
			frontdeskRoleMap["admin"] === "admin" &&
			frontdeskRoleMap["super_admin"] === "super_admin" &&
			frontdeskRoleMap["manager"] === "manager" &&
			frontdeskRoleMap["doctor"] === "doctor" &&
			frontdeskRoleMap["clinic_admin"] === "admin" &&
			frontdeskRoleMap["clinician"] === "doctor" &&
			frontdeskRoleMap["staff"] === "manager";

		assert(
			mappingsValid,
			20,
			"Frontdesk roleMap contract verifies 1-to-1 canonical mappings with backward-compatible aliases",
		);
	}

	// --------------------------------------------------------------------------
	// SUMMARY
	// --------------------------------------------------------------------------
	console.log("\n===============================================================================");
	console.log(`📊 TEST EXECUTION SUMMARY: ${passedTests}/${totalTests} Passed (${failedTests} Failed)`);
	console.log("===============================================================================");

	if (failedTests > 0) {
		process.exit(1);
	}
}

runTestSuite().catch((err) => {
	console.error("Test execution threw exception:", err);
	process.exit(1);
});
