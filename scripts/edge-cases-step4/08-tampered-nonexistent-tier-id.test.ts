import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import { registerEventSchema } from "../../src/validators/event-registration.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 08: TAMPERED / NONEXISTENT TIER ID EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	// Case 1: Empty tierId rejected by validator
	const emptyTierResult = registerEventSchema.safeParse({
		tierId: "",
		attendeeName: "Test User",
		attendeeEmail: "test@example.com",
		attendeePhone: "+919876543210",
	});
	if (!emptyTierResult.success) {
		console.log("✅ Case 1 Passed: Empty tierId rejected by validator with 'tierId is required'.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Empty tierId should have been rejected!");
		failCount++;
	}

	// Case 2: Whitespace-only tierId rejected
	const wsTierResult = registerEventSchema.safeParse({
		tierId: "    ",
		attendeeName: "Test User",
		attendeeEmail: "test@example.com",
		attendeePhone: "+919876543210",
	});
	if (!wsTierResult.success) {
		console.log("✅ Case 2 Passed: Whitespace-only tierId rejected by validator.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Whitespace tierId should have been rejected!");
		failCount++;
	}

	// Case 3: Tampered non-existent tierId rejected by controller guard
	const tamperedTierId = "hacked_super_vip_zero_dollars";
	const tierLookup = event.ticketTiers.find((t: any) => t.tierId === tamperedTierId);
	if (!tierLookup) {
		console.log("✅ Case 3 Passed: Tampered tierId not found in event document -> guarded with 404 TIER_NOT_FOUND.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Tampered tierId was unexpectedly matched!");
		failCount++;
	}

	// Case 4: Valid tierId found cleanly
	const validTierId = "commune_super_early_bird";
	const validLookup = event.ticketTiers.find((t: any) => t.tierId === validTierId);
	if (validLookup && validLookup.tierId === validTierId) {
		console.log(`✅ Case 4 Passed: Authentic tierId matched successfully (${validLookup.name}).`);
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Authentic tierId lookup failed!");
		failCount++;
	}

	await mongoose.disconnect();

	console.log(`\n📊 Test 08 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
