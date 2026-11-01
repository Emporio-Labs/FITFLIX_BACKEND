import { config } from "dotenv";
import { createEventSchema, updateEventSchema } from "../../src/validators/event.validator";
import { EventStatus, EventType } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 05: DUPLICATE TIER ID IN TICKET TIERS ARRAY EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	const basePayload = {
		title: "Duplicate Tier Test Event",
		slug: "duplicate-tier-test-event",
		eventType: EventType.CommunityMeetup,
		status: EventStatus.Draft,
		startDate: new Date("2026-11-20T09:00:00Z"),
		endDate: new Date("2026-11-20T13:00:00Z"),
		reportingTime: "08:30 AM IST",
		venue: {
			name: "Koramangala Fitness Club",
			address: "80ft Road, 4th Block",
			city: "Bengaluru",
		},
		totalCapacity: 200,
	};

	// Case 1: Duplicate tierId "early_bird" in createEventSchema
	const caseDuplicateCreate = createEventSchema.safeParse({
		...basePayload,
		ticketTiers: [
			{
				tierId: "early_bird",
				name: "Early Bird 1",
				type: "paid",
				price: 299,
				totalQuantity: 50,
			},
			{
				tierId: "early_bird", // DUPLICATE!
				name: "Early Bird 2",
				type: "paid",
				price: 399,
				totalQuantity: 50,
			},
		],
	});
	if (!caseDuplicateCreate.success) {
		console.log("✅ Case 1 Passed: Duplicate tierId in createEventSchema rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Duplicate tierId should be rejected!");
		failCount++;
	}

	// Case 2: Duplicate tierId in updateEventSchema
	const caseDuplicateUpdate = updateEventSchema.safeParse({
		ticketTiers: [
			{
				tierId: "vip_access",
				name: "VIP Tier",
				type: "paid",
				price: 999,
				totalQuantity: 20,
			},
			{
				tierId: "vip_access", // DUPLICATE!
				name: "VIP Tier Secondary",
				type: "paid",
				price: 1199,
				totalQuantity: 10,
			},
		],
	});
	if (!caseDuplicateUpdate.success) {
		console.log("✅ Case 2 Passed: Duplicate tierId in updateEventSchema rejected.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Duplicate tierId in update should be rejected!");
		failCount++;
	}

	// Case 3: Distinct tierIds accepted cleanly
	const caseDistinctTiers = createEventSchema.safeParse({
		...basePayload,
		ticketTiers: [
			{
				tierId: "super_early_bird",
				name: "Super Early Bird Pass",
				type: "paid",
				price: 199,
				totalQuantity: 30,
			},
			{
				tierId: "early_bird",
				name: "Early Bird Pass",
				type: "paid",
				price: 299,
				totalQuantity: 40,
			},
			{
				tierId: "standard_pass",
				name: "Standard Pass",
				type: "paid",
				price: 499,
				totalQuantity: 50,
			},
		],
	});
	if (caseDistinctTiers.success) {
		console.log("✅ Case 3 Passed: Distinct tierIds accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Distinct tierIds should be accepted!", caseDistinctTiers.error?.issues);
		failCount++;
	}

	console.log(`\n📊 Test 05 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
