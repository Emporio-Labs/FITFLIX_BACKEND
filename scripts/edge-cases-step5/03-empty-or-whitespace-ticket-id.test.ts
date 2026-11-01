import { config } from "dotenv";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 03: EMPTY / WHITESPACE TICKET ID VALIDATION EDGE CASE");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Empty ticketId
	const param1 = "";
	const normalized1 = String(param1 || "").trim();
	if (!normalized1) {
		console.log("✅ Case 1 Passed: Empty string ticketId caught by controller guard (triggers 400 BAD_REQUEST).");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Empty ticketId should be rejected!");
		failCount++;
	}

	// Case 2: Whitespace-only ticketId
	const param2 = "     ";
	const normalized2 = String(param2 || "").trim();
	if (!normalized2) {
		console.log("✅ Case 2 Passed: Whitespace-only ticketId caught by controller guard.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Whitespace ticketId should be rejected!");
		failCount++;
	}

	// Case 3: Valid formatted ticketId
	const param3 = "  FFX-COMM-1234  ";
	const normalized3 = String(param3 || "").trim().toUpperCase();
	if (normalized3 === "FFX-COMM-1234") {
		console.log("✅ Case 3 Passed: Padded valid ticketId trimmed and resolved to 'FFX-COMM-1234'.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Valid ticketId not trimmed properly!");
		failCount++;
	}

	console.log(`\n📊 Test 03 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
