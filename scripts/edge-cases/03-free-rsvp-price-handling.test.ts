import { config } from "dotenv";
import { ticketTierSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 03: FREE / RSVP PASS PRICE COHERENCE EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: type = "free" but price = 299 (inconsistent!)
	const caseFreeWithPrice = ticketTierSchema.safeParse({
		tierId: "tier_free_inconsistent",
		name: "Free Pass with Price",
		type: "free",
		price: 299,
		totalQuantity: 50,
	});
	if (!caseFreeWithPrice.success) {
		console.log("✅ Case 1 Passed: Free tier with price > 0 rejected by refinement rule.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Free tier should not be allowed to charge price > 0!");
		failCount++;
	}

	// Case 2: type = "rsvp" but price = 50 (inconsistent!)
	const caseRsvpWithPrice = ticketTierSchema.safeParse({
		tierId: "tier_rsvp_inconsistent",
		name: "RSVP Pass with Price",
		type: "rsvp",
		price: 50,
		totalQuantity: 50,
	});
	if (!caseRsvpWithPrice.success) {
		console.log("✅ Case 2 Passed: RSVP tier with price > 0 rejected by refinement rule.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: RSVP tier should not be allowed to charge price > 0!");
		failCount++;
	}

	// Case 3: type = "free" with price = 0 (consistent!)
	const caseFreeClean = ticketTierSchema.safeParse({
		tierId: "tier_free_clean",
		name: "Free Community Pass",
		type: "free",
		price: 0,
		totalQuantity: 100,
	});
	if (caseFreeClean.success && caseFreeClean.data.price === 0) {
		console.log("✅ Case 3 Passed: Free tier with price = 0 accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Valid free pass rejected!");
		failCount++;
	}

	// Case 4: type = "rsvp" with price = 0 (consistent!)
	const caseRsvpClean = ticketTierSchema.safeParse({
		tierId: "tier_rsvp_clean",
		name: "Community RSVP Pass",
		type: "rsvp",
		price: 0,
		totalQuantity: 75,
	});
	if (caseRsvpClean.success && caseRsvpClean.data.price === 0) {
		console.log("✅ Case 4 Passed: RSVP tier with price = 0 accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Valid RSVP pass rejected!");
		failCount++;
	}

	// Case 5: type = "paid" with price = 499 (consistent!)
	const casePaidClean = ticketTierSchema.safeParse({
		tierId: "tier_paid_clean",
		name: "Early Bird Paid Pass",
		type: "paid",
		price: 499,
		totalQuantity: 50,
	});
	if (casePaidClean.success && casePaidClean.data.price === 499) {
		console.log("✅ Case 5 Passed: Paid tier with price = 499 accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Valid paid pass rejected!");
		failCount++;
	}

	console.log(`\n📊 Test 03 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
