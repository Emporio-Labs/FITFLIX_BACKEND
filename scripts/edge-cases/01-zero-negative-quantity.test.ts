import { config } from "dotenv";
import { ticketTierSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 01: ZERO / NEGATIVE / NON-INTEGER TIER QUANTITY EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: totalQuantity = 0
	const caseZero = ticketTierSchema.safeParse({
		tierId: "tier_zero",
		name: "Zero Quantity Tier",
		type: "paid",
		price: 199,
		totalQuantity: 0,
	});
	if (!caseZero.success) {
		console.log("✅ Case 1 Passed: totalQuantity = 0 rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: totalQuantity = 0 should be rejected!");
		failCount++;
	}

	// Case 2: totalQuantity < 0 (-25)
	const caseNeg = ticketTierSchema.safeParse({
		tierId: "tier_neg",
		name: "Negative Quantity Tier",
		type: "paid",
		price: 199,
		totalQuantity: -25,
	});
	if (!caseNeg.success) {
		console.log("✅ Case 2 Passed: totalQuantity = -25 rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: totalQuantity = -25 should be rejected!");
		failCount++;
	}

	// Case 3: totalQuantity is a float (45.7)
	const caseFloat = ticketTierSchema.safeParse({
		tierId: "tier_float",
		name: "Float Quantity Tier",
		type: "paid",
		price: 199,
		totalQuantity: 45.7,
	});
	if (!caseFloat.success) {
		console.log("✅ Case 3 Passed: totalQuantity = 45.7 (non-integer) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: float totalQuantity should be rejected!");
		failCount++;
	}

	// Case 4: maxTicketsPerUser = 0
	const caseMaxTicketsZero = ticketTierSchema.safeParse({
		tierId: "tier_max_zero",
		name: "Zero Max Tickets Tier",
		type: "paid",
		price: 199,
		totalQuantity: 50,
		maxTicketsPerUser: 0,
	});
	if (!caseMaxTicketsZero.success) {
		console.log("✅ Case 4 Passed: maxTicketsPerUser = 0 rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: maxTicketsPerUser = 0 should be rejected!");
		failCount++;
	}

	// Case 5: Valid positive integer totalQuantity = 100
	const caseValid = ticketTierSchema.safeParse({
		tierId: "tier_valid",
		name: "Valid Tier",
		type: "paid",
		price: 199,
		totalQuantity: 100,
		maxTicketsPerUser: 4,
	});
	if (caseValid.success && caseValid.data.totalQuantity === 100) {
		console.log("✅ Case 5 Passed: Valid positive totalQuantity = 100 accepted.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Valid tier should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 01 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
