import { config } from "dotenv";
import { ticketTierSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 07: TIER PERKS SANITIZATION & INTEGRITY EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Empty string perk
	const caseEmptyPerk = ticketTierSchema.safeParse({
		tierId: "tier_empty_perk",
		name: "Tier with Empty Perk",
		type: "paid",
		price: 299,
		totalQuantity: 50,
		perks: ["Official Jersey", "", "Afterparty Pass"],
	});
	if (!caseEmptyPerk.success) {
		console.log("✅ Case 1 Passed: Empty string in perks array rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Empty string in perks should be rejected!");
		failCount++;
	}

	// Case 2: Whitespace-only perk
	const caseWhitespacePerk = ticketTierSchema.safeParse({
		tierId: "tier_ws_perk",
		name: "Tier with Whitespace Perk",
		type: "paid",
		price: 299,
		totalQuantity: 50,
		perks: ["     "],
	});
	if (!caseWhitespacePerk.success) {
		console.log("✅ Case 2 Passed: Whitespace-only string in perks rejected.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Whitespace perk should be rejected!");
		failCount++;
	}

	// Case 3: Empty perks array (valid, perks are optional)
	const caseEmptyArray = ticketTierSchema.safeParse({
		tierId: "tier_no_perks",
		name: "Standard Tier No Perks",
		type: "free",
		price: 0,
		totalQuantity: 100,
		perks: [],
	});
	if (caseEmptyArray.success && caseEmptyArray.data.perks.length === 0) {
		console.log("✅ Case 3 Passed: Empty perks array accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Empty perks array should be accepted!");
		failCount++;
	}

	// Case 4: Multiple rich valid perks
	const caseRichPerks = ticketTierSchema.safeParse({
		tierId: "tier_rich_perks",
		name: "All-Inclusive VIP Tier",
		type: "paid",
		price: 1499,
		totalQuantity: 25,
		perks: [
			"Official Commune Runner Jersey (Black/Gold)",
			"Reserved Front-Row Recovery Yoga Mat",
			"Pour-Over Coffee Tasting by Chapter 5 Roasters",
			"ActiveX Smart Body Composition Scan Voucher",
			"VIP Priority Check-in Fast Track",
		],
	});
	if (caseRichPerks.success && caseRichPerks.data.perks.length === 5) {
		console.log("✅ Case 4 Passed: 5 rich perks accepted and trimmed cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Valid perks array should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 07 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
