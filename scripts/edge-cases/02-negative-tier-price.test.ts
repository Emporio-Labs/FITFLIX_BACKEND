import { config } from "dotenv";
import { ticketTierSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 02: NEGATIVE TIER PRICE & CREDIT COST EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Negative Price (-500)
	const caseNegPrice = ticketTierSchema.safeParse({
		tierId: "tier_neg_price",
		name: "Negative Price Tier",
		type: "paid",
		price: -500,
		totalQuantity: 20,
	});
	if (!caseNegPrice.success) {
		console.log("✅ Case 1 Passed: Negative price (-500) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Negative price should be rejected!");
		failCount++;
	}

	// Case 2: Negative Fractional Price (-0.01)
	const caseNegFractional = ticketTierSchema.safeParse({
		tierId: "tier_neg_frac",
		name: "Negative Fractional Price Tier",
		type: "paid",
		price: -0.01,
		totalQuantity: 20,
	});
	if (!caseNegFractional.success) {
		console.log("✅ Case 2 Passed: Negative fractional price (-0.01) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Negative fractional price should be rejected!");
		failCount++;
	}

	// Case 3: Negative creditCost (-5)
	const caseNegCredits = ticketTierSchema.safeParse({
		tierId: "tier_neg_credits",
		name: "Negative Credits Tier",
		type: "paid",
		price: 100,
		creditCost: -5,
		totalQuantity: 20,
	});
	if (!caseNegCredits.success) {
		console.log("✅ Case 3 Passed: Negative creditCost (-5) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Negative creditCost should be rejected!");
		failCount++;
	}

	// Case 4: Price = 0 (valid for free or paid with 0 amount)
	const caseZeroPrice = ticketTierSchema.safeParse({
		tierId: "tier_zero_price",
		name: "Zero Price Tier",
		type: "free",
		price: 0,
		creditCost: 0,
		totalQuantity: 50,
	});
	if (caseZeroPrice.success && caseZeroPrice.data.price === 0) {
		console.log("✅ Case 4 Passed: price = 0 accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: price = 0 should be accepted!");
		failCount++;
	}

	// Case 5: Large positive price (4999.99)
	const caseLargePrice = ticketTierSchema.safeParse({
		tierId: "tier_large_price",
		name: "VIP Elite Tier",
		type: "paid",
		price: 4999.99,
		totalQuantity: 10,
	});
	if (caseLargePrice.success && caseLargePrice.data.price === 4999.99) {
		console.log("✅ Case 5 Passed: High-value price (4999.99) accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Valid high-value price should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 02 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
