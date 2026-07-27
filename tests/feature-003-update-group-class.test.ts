import Class from "../src/models/Class";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runUpdateTests() {
	console.log("=== Feature Test: FEATURE-003 Update Group Class ===");
	const { baseUrl, close } = await startTestServer();
	let testClassId: string | null = null;

	try {
		const setupClass = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Original Spin Class",
				creditCost: 2,
				status: "ACTIVE",
			},
		});
		testClassId = setupClass.data.class._id;

		console.log("\nTesting Class Update...");
		const updateRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${testClassId}`,
			{
				token: adminToken,
				method: "PUT",
				body: {
					name: "Spin Class Updated",
					creditCost: 5,
				},
			},
		);

		assert(updateRes.status === 200, "Update class returns 200");
		assert(
			updateRes.data.class.name === "Spin Class Updated",
			"Class name updated successfully",
		);
		assert(
			updateRes.data.class.creditCost === 5,
			"Class creditCost updated successfully",
		);

		const invalidUpdate = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${testClassId}`,
			{
				token: adminToken,
				method: "PUT",
				body: {
					creditCost: 0,
				},
			},
		);
		assert(invalidUpdate.status === 400, "Updating creditCost to 0 returns 400");

		console.log("\n🎉 FEATURE-003 Update Class Tests Passed!");
	} finally {
		if (testClassId) {
			await Class.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runUpdateTests().catch((err) => {
	console.error("Update class test failed:", err);
	process.exit(1);
});
