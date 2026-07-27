import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runValidationTests() {
	console.log("=== Feature Test: Request Payload Validation Guards ===");
	const { baseUrl, close } = await startTestServer();

	try {
		console.log("\nRunning Validation Checks...");
		const emptyName = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "   ", creditCost: 2 },
		});
		assert(emptyName.status === 400, "Create fails with 400 when name is empty");

		const zeroCredit = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Zero Credit", creditCost: 0 },
		});
		assert(
			zeroCredit.status === 400,
			"Create fails with 400 when creditCost is less than 1",
		);

		const negativeCredit = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Negative Credit", creditCost: -5 },
		});
		assert(
			negativeCredit.status === 400,
			"Create fails with 400 when creditCost is negative",
		);

		const floatCredit = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Float Credit", creditCost: 2.5 },
		});
		assert(
			floatCredit.status === 400,
			"Create fails with 400 when creditCost is not an integer",
		);

		console.log("\n🎉 Validation Feature Tests Passed!");
	} finally {
		await close();
	}
}

runValidationTests().catch((err) => {
	console.error("Validation test failed:", err);
	process.exit(1);
});
