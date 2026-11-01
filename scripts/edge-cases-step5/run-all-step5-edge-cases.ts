import { execSync } from "child_process";
import path from "path";

const scripts = [
	"01-case-insensitive-ticket-id.test.ts",
	"02-nonexistent-ticket-id-404.test.ts",
	"03-empty-or-whitespace-ticket-id.test.ts",
	"04-qr-payload-tampering-detection.test.ts",
	"05-checked-in-pass-status-stamp.test.ts",
	"06-unpaid-pending-pass-handling.test.ts",
	"07-tier-fallback-styling.test.ts",
	"08-calendar-ics-payload-integrity.test.ts",
	"09-orphaned-pass-event-not-found.test.ts",
	"10-bulk-pass-wallet-aggregation.test.ts",
];

console.log("===================================================================");
console.log("🚀 RUNNING ALL 10 ADVANCED STEP 5 DIGITAL PASS EDGE-CASE TEST SUITES");
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
console.log(`🏁 STEP 5 FINAL RESULTS: ${passedSuites}/10 Suites Passed, ${failedSuites} Failed.`);
console.log("===================================================================\n");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 STEP 5 EDGE CASES PASSED WITH 100% SUCCESS!");
}
