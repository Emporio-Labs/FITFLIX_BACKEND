import { config } from "dotenv";
import { createEventSchema, updateEventSchema } from "../../src/validators/event.validator";
import { EventStatus, EventType } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 04: CAPACITY VS TIER ALLOTMENT BOUNDS EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	const basePayload = {
		title: "Capacity Bounds Test Event",
		slug: "capacity-bounds-test-event",
		eventType: EventType.CommunityMeetup,
		status: EventStatus.Draft,
		startDate: new Date("2026-11-20T09:00:00Z"),
		endDate: new Date("2026-11-20T13:00:00Z"),
		reportingTime: "08:30 AM IST",
		venue: {
			name: "Indiranagar Hub",
			address: "100ft Road, Indiranagar",
			city: "Bengaluru",
		},
		totalCapacity: 100, // Maximum allowed
	};

	// Case 1: Tiers sum to 150, exceeding totalCapacity 100
	const caseExceeded = createEventSchema.safeParse({
		...basePayload,
		ticketTiers: [
			{
				tierId: "tier_a",
				name: "Tier A",
				type: "paid",
				price: 299,
				totalQuantity: 80,
			},
			{
				tierId: "tier_b",
				name: "Tier B",
				type: "paid",
				price: 499,
				totalQuantity: 70, // 80 + 70 = 150 > 100!
			},
		],
	});
	if (!caseExceeded.success) {
		console.log("✅ Case 1 Passed: Sum of tier quantities (150) exceeding totalCapacity (100) rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Exceeded tier quantities should be rejected!");
		failCount++;
	}

	// Case 2: Tiers sum to exactly 100 == totalCapacity 100
	const caseExact = createEventSchema.safeParse({
		...basePayload,
		ticketTiers: [
			{
				tierId: "tier_a",
				name: "Tier A",
				type: "paid",
				price: 299,
				totalQuantity: 60,
			},
			{
				tierId: "tier_b",
				name: "Tier B",
				type: "paid",
				price: 499,
				totalQuantity: 40, // 60 + 40 = 100 == 100
			},
		],
	});
	if (caseExact.success) {
		console.log("✅ Case 2 Passed: Tiers sum exactly matching capacity (100) accepted.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Exact match should be accepted!", caseExact.error?.issues);
		failCount++;
	}

	// Case 3: Tiers sum to 70 < totalCapacity 100 (leaving unallocated capacity for door tickets)
	const caseUnder = createEventSchema.safeParse({
		...basePayload,
		ticketTiers: [
			{
				tierId: "tier_a",
				name: "Tier A",
				type: "free",
				price: 0,
				totalQuantity: 70, // 70 < 100
			},
		],
	});
	if (caseUnder.success) {
		console.log("✅ Case 3 Passed: Tiers sum below total capacity (70 < 100) accepted.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Below capacity should be accepted!");
		failCount++;
	}

	// Case 4: Partial update with updateEventSchema where tier quantity exceeds capacity
	const caseUpdateExceeded = updateEventSchema.safeParse({
		totalCapacity: 50,
		ticketTiers: [
			{
				tierId: "tier_vip",
				name: "VIP Tier",
				type: "paid",
				price: 999,
				totalQuantity: 75, // 75 > 50!
			},
		],
	});
	if (!caseUpdateExceeded.success) {
		console.log("✅ Case 4 Passed: Partial update exceeding capacity rejected.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Update exceeding capacity should be rejected!");
		failCount++;
	}

	console.log(`\n📊 Test 04 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
