import { execSync } from "child_process";
import path from "path";

const scripts = [
	"01-offline-cache-payload-completeness-and-corrupt-json-resilience.test.ts",
	"02-gate-scanner-rejection-of-expired-or-cancelled-pass.test.ts",
	"03-offline-airplane-mode-to-online-transition-sync.test.ts",
	"04-concurrent-gate-scan-race-condition.test.ts",
	"05-multi-tier-co-branding-and-perks-rendering-contract.test.ts",
	"06-live-polling-backoff-and-terminal-state.test.ts",
	"07-tampered-qr-token-signature-verification.test.ts",
	"08-wallet-tab-partition-and-date-sorting.test.ts",
	"09-duplicate-checkin-idempotency-and-timestamp-preservation.test.ts",
	"10-high-contrast-qr-optical-density-and-uri-spec.test.ts",
];

console.log("===================================================================");
console.log("🚀 RUNNING ALL 10 ADVANCED STEP 8 'MY PASSES' & OFFLINE UX SUITES");
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
console.log(`🏁 STEP 8 FINAL RESULTS: ${passedSuites}/10 Suites Passed, ${failedSuites} Failed.`);
console.log("===================================================================\n");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 STEP 8 ADVANCED EDGE CASES PASSED WITH 100% SUCCESS!");
}
