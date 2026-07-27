import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runAuthTests() {
	console.log("=== Feature Test: Route Protection & Authorization ===");
	const { baseUrl, close } = await startTestServer();

	try {
		console.log("\nRunning Auth Checks...");
		const noToken = await fetchJson(baseUrl, "/api/v1/classes");
		assert(noToken.status === 401, "GET /classes without token returns 401");

		const invalidToken = await fetchJson(baseUrl, "/api/v1/classes", {
			token: "invalid-token",
		});
		assert(
			invalidToken.status === 401,
			"GET /classes with invalid token returns 401",
		);

		const forbiddenUser = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: userToken,
			method: "POST",
			body: { name: "Test", creditCost: 1 },
		});
		assert(
			forbiddenUser.status === 403,
			"POST /admin/classes with user token returns 403",
		);

		console.log("\n🎉 Route Protection Feature Tests Passed!");
	} finally {
		await close();
	}
}

runAuthTests().catch((err) => {
	console.error("Auth test failed:", err);
	process.exit(1);
});
