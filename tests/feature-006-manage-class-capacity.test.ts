import Class from "../src/models/Class";
import Slot from "../src/models/Slots";
import {
	adminToken,
	assert,
	fetchJson,
	startTestServer,
} from "./test-helpers";

async function runCapacityTests() {
	console.log("=== Feature Test: FEATURE-006 Manage Class Capacity ===");
	const { baseUrl, close } = await startTestServer();
	let createdClassId: string | null = null;
	let createdSlotId: string | null = null;

	try {
		console.log("\nTesting Capacity Setup & Slot Capacity Update...");
		const slotRes = await fetchJson(baseUrl, "/slots", {
			token: adminToken,
			method: "POST",
			body: {
				startTime: "10:00",
				endTime: "11:00",
				capacity: 15,
				isDaily: true,
			},
		});
		assert(slotRes.status === 201, "Creates slot with 15 capacity (201)");
		createdSlotId = slotRes.data.slot._id;

		const patchSlot = await fetchJson(baseUrl, `/slots/${createdSlotId}`, {
			token: adminToken,
			method: "PATCH",
			body: {
				capacity: 20,
				remainingCapacity: 20,
			},
		});
		assert(patchSlot.status === 200, "Updates slot capacity via PATCH (200)");
		assert(
			patchSlot.data.slot.capacity === 20,
			"Slot capacity updated to 20",
		);

		const classRes = await fetchJson(baseUrl, "/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "HIIT Session Capacity Test",
				creditCost: 3,
				status: "ACTIVE",
			},
		});
		assert(classRes.status === 201, "Creates class with capacity setting");
		createdClassId = classRes.data.class._id;

		console.log("\n🎉 FEATURE-006 Capacity Feature Tests Passed!");
	} finally {
		if (createdClassId) {
			await Class.findByIdAndDelete(createdClassId);
		}
		if (createdSlotId) {
			await Slot.findByIdAndDelete(createdSlotId);
		}
		await close();
	}
}

runCapacityTests().catch((err) => {
	console.error("Capacity test failed:", err);
	process.exit(1);
});
