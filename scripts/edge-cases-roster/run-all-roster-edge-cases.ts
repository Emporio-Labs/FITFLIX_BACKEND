import { execSync } from "child_process";
import path from "path";

const testFiles = [
	"01-zero-bookings-safe-division.test.ts",
	"02-tier-sold-out-boundary-and-capacity-overflow.test.ts",
	"03-search-whitespace-and-special-characters.test.ts",
	"04-concurrency-and-rapid-checkin-toggles.test.ts",
	"05-payment-status-filtering-and-free-claims.test.ts",
	"06-orphaned-registration-missing-tier.test.ts",
	"07-csv-export-sanitization-defense.test.ts",
	"08-checkin-timestamp-preservation-and-undo.test.ts",
	"09-multi-filter-compound-intersection.test.ts",
	"10-high-volume-roster-stress-and-performance.test.ts",
];

console.log("==========================================================================");
console.log("🚀 MASTER TEST RUNNER: 10 ADVANCED EDGE-CASE SUITES FOR EVENT ATTENDEES ROSTER");
console.log("==========================================================================\n");

let passedSuites = 0;
let failedSuites = 0;
const results: { file: string; status: "PASSED" | "FAILED"; error?: string }[] = [];

for (let i = 0; i < testFiles.length; i++) {
	const file = testFiles[i];
	const filePath = path.join(__dirname, file);
	console.log(`[${i + 1}/${testFiles.length}] Running: ${file}...`);

	try {
		const output = execSync(`bun run "${filePath}"`, {
			stdio: "pipe",
			encoding: "utf-8",
		});
		console.log(output.trim());
		console.log(`✅ [${file}] SUITE PASSED\n--------------------------------------------------------------------------\n`);
		passedSuites++;
		results.push({ file, status: "PASSED" });
	} catch (error: any) {
		console.error(`❌ [${file}] SUITE FAILED`);
		const errorOutput = error.stdout?.toString() || error.stderr?.toString() || error.message;
		console.error(errorOutput);
		console.error("\n--------------------------------------------------------------------------\n");
		failedSuites++;
		results.push({ file, status: "FAILED", error: errorOutput });
	}
}

console.log("==========================================================================");
console.log("                          FINAL SCORECARD                                 ");
console.log("==========================================================================");
console.log(`Total Test Suites: ${testFiles.length}`);
console.log(`Passed:            ${passedSuites} ✅`);
console.log(`Failed:            ${failedSuites} ${failedSuites > 0 ? "❌" : ""}`);
console.log("==========================================================================");

if (failedSuites > 0) {
	process.exit(1);
} else {
	console.log("🎉 ALL 10 ROSTER & CHECK-IN ADVANCED EDGE-CASE TEST SUITES PASSED! 🎉\n");
	process.exit(0);
}
