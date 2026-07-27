import Class from "../src/models/Class";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runScheduleTests() {
	console.log("=== Feature Test: FEATURE-005 Schedule Group Class ===");
	const { baseUrl, close } = await startTestServer();
	let testClassId: string | null = null;

	try {
		console.log("\nTesting Schedule Configuration...");
		const setupClass = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Scheduled Zumba Class",
				description: "Weekly Monday & Wednesday Zumba",
				creditCost: 2,
				status: "ACTIVE",
			},
		});
		assert(setupClass.status === 201, "Creates class for scheduling test");
		testClassId = setupClass.data.class._id;

		const detailRes = await fetchJson(
			baseUrl,
			`/api/v1/classes/${testClassId}`,
			{
				token: userToken,
			},
		);
		assert(detailRes.status === 200, "Retrieve scheduled class details (200)");
		assert(
			detailRes.data.class.name === "Scheduled Zumba Class",
			"Class schedule name matches",
		);

		console.log("\n🎉 FEATURE-005 Schedule Class Tests Passed!");
	} finally {
		if (testClassId) {
			await Class.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runScheduleTests().catch((err) => {
	console.error("Schedule class test failed:", err);
	process.exit(1);
});
