import Class from "../src/models/Class";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runPublishTests() {
	console.log("=== Feature Test: FEATURE-007 Publish / Unpublish Class ===");
	const { baseUrl, close } = await startTestServer();
	let testClassId: string | null = null;

	try {
		console.log("\n1. Creating active test class...");
		const setupRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Publish Test Class",
				description: "Testing publish toggle endpoint",
				creditCost: 3,
				isPublished: true,
			},
		});
		assert(setupRes.status === 201, "Creates class successfully (201)");
		testClassId = setupRes.data.class._id;

		console.log("\n2. Verifying member list contains published class...");
		const memberList1 = await fetchJson(baseUrl, "/api/v1/classes", {
			token: userToken,
		});
		assert(memberList1.status === 200, "Member list returns 200");
		const found1 = memberList1.data.classes.some(
			(c: any) => c._id === testClassId,
		);
		assert(found1, "Published class is visible in member listing");

		console.log("\n3. Unpublishing class via PATCH /publish endpoint...");
		const unpublishRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/${testClassId}/publish`,
			{
				token: adminToken,
				method: "PATCH",
				body: { isPublished: false },
			},
		);
		assert(unpublishRes.status === 200, "Unpublish endpoint returns 200");
		assert(
			unpublishRes.data.class.isPublished === false,
			"Class isPublished is updated to false",
		);

		console.log(
			"\n4. Verifying member list excludes unpublished class (Unpublished State Hide)...",
		);
		const memberList2 = await fetchJson(baseUrl, "/api/v1/classes", {
			token: userToken,
		});
		const found2 = memberList2.data.classes.some(
			(c: any) => c._id === testClassId,
		);
		assert(!found2, "Unpublished class is hidden from member listing");

		console.log("\n5. Re-publishing class via PATCH schedule endpoint...");
		const republishRes = await fetchJson(
			baseUrl,
			`/api/v1/admin/classes/schedule/${testClassId}/publish`,
			{
				token: adminToken,
				method: "PATCH",
				body: { is_published: true },
			},
		);
		assert(republishRes.status === 200, "Re-publish endpoint returns 200");
		assert(
			republishRes.data.class.isPublished === true,
			"Class isPublished is restored to true",
		);

		console.log("\n🎉 FEATURE-007 Publish / Unpublish Class Tests Passed!");
	} finally {
		if (testClassId) {
			await Class.findByIdAndDelete(testClassId);
		}
		await close();
	}
}

runPublishTests().catch((err) => {
	console.error("Publish test failed:", err);
	process.exit(1);
});
