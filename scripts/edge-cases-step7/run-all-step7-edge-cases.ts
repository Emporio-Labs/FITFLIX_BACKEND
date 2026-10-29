import { execSync } from "child_process";
import path from "path";

const scripts = [
	"01-duplicate-registration-recovery.test.ts",
	"02-tier-sold-out-in-flight-rejection.test.ts",
	"03-overall-event-capacity-exhaustion.test.ts",
	"04-offline-pass-payload-caching-resilience.test.ts",
	"05-anti-tamper-qr-payload-verification.test.ts",
	"06-live-checkin-realtime-polling-transition.test.ts",
	"07-rapid-double-tap-race-condition.test.ts",
	"08-empty-feed-graceful-fallback.test.ts",
	"09-timezone-date-window-normalization.test.ts",
	"10-multi-event-pass-wallet-aggregation.test.ts",
];

console.log("===================================================================");
console.log("🚀 RUNNING ALL 10 ADVANCED STEP 7 FLUTTER EVENTS EDGE-CASE SUITES");
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
console.log(`🏁 STEP 7 FINAL RESULTS: ${passedSuites}/10 Suites Passed, ${failedSuites} Failed.`);
console.log("===================================================================\n");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 STEP 7 ADVANCED EDGE CASES PASSED WITH 100% SUCCESS!");
}
