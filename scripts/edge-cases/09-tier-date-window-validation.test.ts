import { config } from "dotenv";
import { ticketTierSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 09: TIER SALES DATE WINDOW VALIDATION EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: validUntil is earlier than validFrom (invalid window!)
	const caseInvertedDates = ticketTierSchema.safeParse({
		tierId: "tier_inverted",
		name: "Inverted Window Tier",
		type: "paid",
		price: 399,
		totalQuantity: 50,
		validFrom: new Date("2026-11-15T00:00:00Z"),
		validUntil: new Date("2026-11-01T00:00:00Z"), // Earlier than validFrom!
	});
	if (!caseInvertedDates.success) {
		console.log("✅ Case 1 Passed: Inverted sales window (validUntil < validFrom) rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Inverted sales window should be rejected!");
		failCount++;
	}

	// Case 2: validUntil is identical to validFrom (edge case valid single-day cutoff)
	const sameDate = new Date("2026-11-15T12:00:00Z");
	const caseSameDate = ticketTierSchema.safeParse({
		tierId: "tier_same_date",
		name: "Single Moment Cutoff Tier",
		type: "paid",
		price: 399,
		totalQuantity: 50,
		validFrom: sameDate,
		validUntil: sameDate,
	});
	if (caseSameDate.success) {
		console.log("✅ Case 2 Passed: validUntil == validFrom accepted.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Identical dates should be accepted!");
		failCount++;
	}

	// Case 3: validUntil is strictly after validFrom
	const caseValidWindow = ticketTierSchema.safeParse({
		tierId: "tier_valid_window",
		name: "Early Bird 1-Week Window",
		type: "paid",
		price: 299,
		totalQuantity: 100,
		validFrom: new Date("2026-11-01T00:00:00Z"),
		validUntil: new Date("2026-11-08T23:59:59Z"),
	});
	if (caseValidWindow.success) {
		console.log("✅ Case 3 Passed: Valid sequential sales window accepted.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Valid window should be accepted!");
		failCount++;
	}

	// Case 4: Open sales window (no validFrom or validUntil specified)
	const caseNoDates = ticketTierSchema.safeParse({
		tierId: "tier_open_window",
		name: "Always Available Pass",
		type: "free",
		price: 0,
		totalQuantity: 200,
	});
	if (caseNoDates.success) {
		console.log("✅ Case 4 Passed: Open date window accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Open window should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 09 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
