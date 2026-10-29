import { config } from "dotenv";
import { sponsorSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 08: SPONSOR MISSING / INVALID FIELDS EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Empty sponsor name
	const caseEmptyName = sponsorSchema.safeParse({
		name: "",
		logoUrl: "https://api.fitflix.in/uploads/sponsors/redbull.png",
		tier: "Title Sponsor",
	});
	if (!caseEmptyName.success) {
		console.log("✅ Case 1 Passed: Empty sponsor name rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Empty sponsor name should be rejected!");
		failCount++;
	}

	// Case 2: Whitespace-only sponsor name
	const caseWsName = sponsorSchema.safeParse({
		name: "   ",
		logoUrl: "https://api.fitflix.in/uploads/sponsors/redbull.png",
		tier: "Title Sponsor",
	});
	if (!caseWsName.success) {
		console.log("✅ Case 2 Passed: Whitespace-only sponsor name rejected.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Whitespace sponsor name should be rejected!");
		failCount++;
	}

	// Case 3: Missing logoUrl
	const caseMissingLogo = sponsorSchema.safeParse({
		name: "Red Bull",
		tier: "Energy Partner",
	});
	if (!caseMissingLogo.success) {
		console.log("✅ Case 3 Passed: Missing sponsor logoUrl rejected.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Missing logoUrl should be rejected!");
		failCount++;
	}

	// Case 4: Empty string logoUrl
	const caseEmptyLogo = sponsorSchema.safeParse({
		name: "Red Bull",
		logoUrl: "",
		tier: "Energy Partner",
	});
	if (!caseEmptyLogo.success) {
		console.log("✅ Case 4 Passed: Empty string logoUrl rejected.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Empty logoUrl should be rejected!");
		failCount++;
	}

	// Case 5: Valid sponsor
	const caseValid = sponsorSchema.safeParse({
		name: "Google Cloud",
		logoUrl: "https://api.fitflix.in/uploads/sponsors/google-cloud.png",
		tier: "Headline Sponsor",
	});
	if (caseValid.success && caseValid.data.name === "Google Cloud") {
		console.log("✅ Case 5 Passed: Valid headline sponsor accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Valid sponsor should be accepted!");
		failCount++;
	}

	console.log(`\n📊 Test 08 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
