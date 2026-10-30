import { execSync } from "child_process";
import path from "path";

const scripts = [
	"01-zero-negative-quantity.test.ts",
	"02-negative-tier-price.test.ts",
	"03-free-rsvp-price-handling.test.ts",
	"04-capacity-tier-allotment-bounds.test.ts",
	"05-duplicate-tier-id-in-event.test.ts",
	"06-collaborator-empty-fields.test.ts",
	"07-perk-sanitization.test.ts",
	"08-sponsor-missing-name.test.ts",
	"09-tier-date-window-validation.test.ts",
	"10-atomic-multi-tier-update.test.ts",
];

console.log("===================================================================");
console.log("🚀 RUNNING ALL 10 ADVANCED STEP 3 EDGE-CASE TEST SUITES");
console.log("===================================================================\n");

let passedSuites = 0;
let failedSuites = 0;

for (const script of scripts) {
	const scriptPath = path.join(__dirname, script);
	console.log(`\n▶️  Executing: ${script}...`);
	try {
		const output = execSync(`bun run "${scriptPath}"`, { stdio: "inherit" });
		passedSuites++;
	} catch (error) {
		console.error(`❌ Suite failed: ${script}`);
		failedSuites++;
	}
}

console.log("\n===================================================================");
console.log(`🏁 FINAL RESULTS: ${passedSuites}/10 Suites Passed, ${failedSuites} Failed.`);
console.log("===================================================================\n");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 STEP 3 EDGE CASES PASSED WITH 100% SUCCESS!");
}
