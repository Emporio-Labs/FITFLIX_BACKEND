import Class from "../src/models/Class";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runCreateTests() {
	console.log("=== Feature Test: FEATURE-002 Create Group Class ===");
	const { baseUrl, close } = await startTestServer();
	let createdClassId: string | null = null;

	try {
		console.log("\nTesting Class Creation...");
		const res = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Test Create Pilates Class",
				description: "Core strength training",
				creditCost: 3,
				status: "ACTIVE",
			},
		});

		assert(res.status === 201, "Creates class successfully (201)");
		assert(Boolean(res.data.class._id), "Class response contains _id");
		createdClassId = res.data.class._id;

		console.log("\n🎉 FEATURE-002 Create Class Tests Passed!");
	} finally {
		if (createdClassId) {
			await Class.findByIdAndDelete(createdClassId);
		}
		await close();
	}
}

runCreateTests().catch((err) => {
	console.error("Create class test failed:", err);
	process.exit(1);
});
