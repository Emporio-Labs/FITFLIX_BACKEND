import { execSync } from "child_process";
import path from "path";

const scripts = [
	"01-duplicate-email-same-event.test.ts",
	"02-duplicate-phone-same-event.test.ts",
	"03-same-user-different-events.test.ts",
	"04-tier-sold-out-rejection.test.ts",
	"05-overall-capacity-sold-out.test.ts",
	"06-draft-cancelled-closed-event-guard.test.ts",
	"07-tier-sales-window-dates.test.ts",
	"08-tampered-nonexistent-tier-id.test.ts",
	"09-malformed-email-phone-validation.test.ts",
	"10-concurrency-and-roster-integrity.test.ts",
];

console.log("===================================================================");
console.log("🚀 RUNNING ALL 10 ADVANCED STEP 4 REGISTRATION EDGE-CASE TEST SUITES");
console.log("===================================================================\n");

let passedSuites = 0;
let failedSuites = 0;

for (const script of scripts) {
	const scriptPath = path.join(__dirname, script);
	console.log(`\n▶️  Executing: ${script}...`);
	try {
		execSync(`bun run "${scriptPath}"`, { stdio: "inherit" });
		passedSuites++;
	} catch (error) {
		console.error(`❌ Suite failed: ${script}`);
		failedSuites++;
	}
}

console.log("\n===================================================================");
console.log(`🏁 STEP 4 FINAL RESULTS: ${passedSuites}/10 Suites Passed, ${failedSuites} Failed.`);
console.log("===================================================================\n");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 STEP 4 EDGE CASES PASSED WITH 100% SUCCESS!");
}
