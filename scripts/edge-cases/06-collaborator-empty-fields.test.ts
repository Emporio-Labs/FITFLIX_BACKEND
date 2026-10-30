import { config } from "dotenv";
import { collaboratorSchema } from "../../src/validators/event.validator";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 06: COLLABORATOR EMPTY / INVALID FIELDS EDGE CASES");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Case 1: Empty name
	const caseEmptyName = collaboratorSchema.safeParse({
		name: "",
		role: "Co-Host",
		logoUrl: "https://example.com/logo.png",
	});
	if (!caseEmptyName.success) {
		console.log("✅ Case 1 Passed: Empty collaborator name rejected.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Empty collaborator name should be rejected!");
		failCount++;
	}

	// Case 2: Whitespace-only name
	const caseWhitespaceName = collaboratorSchema.safeParse({
		name: "    ",
		role: "Co-Host",
		logoUrl: "https://example.com/logo.png",
	});
	if (!caseWhitespaceName.success) {
		console.log("✅ Case 2 Passed: Whitespace-only collaborator name rejected.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Whitespace-only collaborator name should be rejected!");
		failCount++;
	}

	// Case 3: Missing / empty logoUrl
	const caseEmptyLogo = collaboratorSchema.safeParse({
		name: "Chapter 5 Coffee",
		role: "Co-Host",
		logoUrl: "",
	});
	if (!caseEmptyLogo.success) {
		console.log("✅ Case 3 Passed: Empty logoUrl rejected.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Empty logoUrl should be rejected!");
		failCount++;
	}

	// Case 4: Missing logoUrl field entirely
	const caseMissingLogo = collaboratorSchema.safeParse({
		name: "Chapter 5 Coffee",
		role: "Co-Host",
	});
	if (!caseMissingLogo.success) {
		console.log("✅ Case 4 Passed: Missing logoUrl rejected.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Missing logoUrl should be rejected!");
		failCount++;
	}

	// Case 5: Valid collaborator with websiteUrl
	const caseValid = collaboratorSchema.safeParse({
		name: "Chapter 5 Speciality Coffee",
		role: "Co-Host & Roastery Partner",
		logoUrl: "https://api.fitflix.in/uploads/collaborators/chapter-5.png",
		websiteUrl: "https://chapter5coffee.com",
	});
	if (caseValid.success) {
		console.log("✅ Case 5 Passed: Valid collaborator accepted cleanly.");
		passCount++;
	} else {
		console.error("❌ Case 5 Failed: Valid collaborator should be accepted!", caseValid.error?.issues);
		failCount++;
	}

	console.log(`\n📊 Test 06 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
