import { config } from "dotenv";
import { registerEventSchema } from "../../src/validators/event-registration.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 09: MALFORMED EMAIL & PHONE NUMBER VALIDATION EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Malformed email without @
	const case1 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "John Doe",
		attendeeEmail: "johndoe.google.com",
		attendeePhone: "+919876543210",
	});
	if (!case1.success) {
		console.log("✅ Case 1 Passed: Email missing '@' rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Email without '@' should be rejected!");
		failCount++;
	}

	// Case 2: Incomplete email (no domain after @)
	const case2 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "John Doe",
		attendeeEmail: "johndoe@",
		attendeePhone: "+919876543210",
	});
	if (!case2.success) {
		console.log("✅ Case 2 Passed: Incomplete email 'user@' rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Incomplete email should be rejected!");
		failCount++;
	}

	// Case 3: Phone number too short (under 7 digits)
	const case3 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "John Doe",
		attendeeEmail: "johndoe@example.com",
		attendeePhone: "12345",
	});
	if (!case3.success) {
		console.log("✅ Case 3 Passed: Short phone number (< 7 digits) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Short phone should be rejected!");
		failCount++;
	}

	// Case 4: Phone number too long (> 15 digits)
	const case4 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "John Doe",
		attendeeEmail: "johndoe@example.com",
		attendeePhone: "+91987654321012345678",
	});
	if (!case4.success) {
		console.log("✅ Case 4 Passed: Extremely long phone number (> 15 digits) rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Long phone should be rejected!");
		failCount++;
	}

	// Case 5: Empty attendee name
	const case5 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "    ",
		attendeeEmail: "johndoe@example.com",
		attendeePhone: "+919876543210",
	});
	if (!case5.success) {
		console.log("✅ Case 5 Passed: Blank/whitespace attendee name rejected correctly.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Blank name should be rejected!");
		failCount++;
	}

	// Case 6: Fully valid payload
	const case6 = registerEventSchema.safeParse({
		tierId: "tier_1",
		attendeeName: "Priya Sharma",
		attendeeEmail: "Priya.Sharma@Gmail.COM", // uppercase test
		attendeePhone: "+91-98765-43210",
		answers: { tshirtSize: "M" },
	});
	if (case6.success && case6.data.attendeeEmail === "priya.sharma@gmail.com") {
		console.log("✅ Case 6 Passed: Valid payload accepted and email lowercased automatically.");
		passCount++;
	} else {
		console.error("❌ Case 6 Failed: Valid payload should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 09 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
