import {
	adminToken,
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runFeature009Tests() {
	console.log("=== Feature Test: FEATURE-009 Access Control (RBAC & Roles) ===");
	const { baseUrl, close } = await startTestServer();

	const memberToken = generateTestToken("ROLE_MEMBER", "507f1f77bcf86cd799439099");
	const frontEndStaffToken = generateTestToken(
		"ROLE_FRONT_END_STAFF",
		"507f1f77bcf86cd799439098",
	);
	const frontDeskStaffToken = generateTestToken(
		"ROLE_FRONT_DESK_STAFF",
		"507f1f77bcf86cd799439097",
	);

	try {
		console.log("\n1. Testing Admin Exclusivity (Member restricted from Admin Class creation)...");
		const memberAdminRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: userToken,
			method: "POST",
			body: {
				name: "Unauthorized Class Attempt",
				creditCost: 3,
			},
		});
		assert(
			memberAdminRes.status === 403,
			"Member userToken request to POST /api/v1/admin/classes returns 403 Forbidden",
		);

		const roleMemberRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: memberToken,
			method: "POST",
			body: {
				name: "Unauthorized Class Attempt 2",
				creditCost: 3,
			},
		});
		assert(
			roleMemberRes.status === 403,
			"Member role token (ROLE_MEMBER) request to POST /api/v1/admin/classes returns 403 Forbidden",
		);

		console.log("\n2. Testing Lead Management Restrictions for Front-End Staff...");
		const staffClassRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: frontEndStaffToken,
			method: "POST",
			body: {
				name: "Staff Class Creation Attempt",
				creditCost: 3,
			},
		});
		assert(
			staffClassRes.status === 403,
			"Front-End Staff (ROLE_FRONT_END_STAFF) request to POST /api/v1/admin/classes returns 403 Forbidden",
		);

		console.log("\n3. Testing Front-End Staff Lead Access...");
		const staffLeadRes = await fetchJson(baseUrl, "/leads", {
			token: frontEndStaffToken,
			method: "GET",
		});
		assert(
			staffLeadRes.status === 200,
			"Front-End Staff (ROLE_FRONT_END_STAFF) request to GET /leads returns 200 OK",
		);

		console.log("\n4. Testing Valid Authenticated Requests for Authorized Roles...");
		const adminCreateRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "RBAC Verified Class",
				description: "Class created by verified admin",
				creditCost: 4,
				maxParticipants: 15,
			},
		});
		assert(
			adminCreateRes.status === 201,
			"Front Desk Admin (ROLE_FRONT_DESK_STAFF / admin) request to POST /api/v1/admin/classes returns 201 Created",
		);

		const memberGetRes = await fetchJson(baseUrl, "/api/v1/classes", {
			token: memberToken,
			method: "GET",
		});
		assert(
			memberGetRes.status === 200,
			"Member (ROLE_MEMBER) request to GET /api/v1/classes returns 200 OK",
		);

		console.log("\n🎉 FEATURE-009 Access Control (RBAC & Roles) Tests Passed!");
	} finally {
		await close();
	}
}

runFeature009Tests().catch((err) => {
	console.error("RBAC feature test failed:", err);
	process.exit(1);
});
