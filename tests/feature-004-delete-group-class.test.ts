import Class from "../src/models/Class";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runDeleteTests() {
	console.log("=== Feature Test: FEATURE-004 Delete Group Class ===");
	const { baseUrl, close } = await startTestServer();
	let testClassId: string | null = null;

	try {
		const setupClass = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Class To Be Retired",
				creditCost: 3,
				status: "ACTIVE",
			},
		});
		testClassId = setupClass.data.class._id;

		console.log("\nTesting Class Soft Delete / Deactivation...");
		const deleteRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${testClassId}`,
			{
				token: adminToken,
				method: "DELETE",
			},
		);

		assert(deleteRes.status === 200, "Retire class returns 200");
		assert(
			deleteRes.data.class.status === "INACTIVE",
			"Retired class status is updated to INACTIVE in database",
		);

		const memberLookup = await fetchJson(
			baseUrl,
			`/api/v1/classes/${testClassId}`,
			{
				token: userToken,
			},
		);
		assert(
			memberLookup.data.class.status === "INACTIVE",
			"Class status verified as INACTIVE for members",
		);

		console.log("\n🎉 FEATURE-004 Delete Class Tests Passed!");
	} finally {
		if (testClassId) {
			await Class.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runDeleteTests().catch((err) => {
	console.error("Delete class test failed:", err);
	process.exit(1);
});
