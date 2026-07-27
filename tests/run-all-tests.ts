import { execSync } from "node:child_process";
import path from "node:path";

const testFiles = [
	"feature-class-auth.test.ts",
	"feature-class-validation.test.ts",
	"feature-002-create-group-class.test.ts",
	"feature-003-update-group-class.test.ts",
	"feature-004-delete-group-class.test.ts",
	"feature-005-schedule-group-class.test.ts",
	"feature-006-manage-class-capacity.test.ts",
];

async function runRegressionSuite() {
	console.log("==================================================");
	console.log("🚀 STARTING FULL GROUP CLASS REGRESSION TEST SUITE");
	console.log("==================================================\n");

	let passedCount = 0;
	let failedCount = 0;
	const testsDir = __dirname;

	for (const file of testFiles) {
		const filePath = path.join(testsDir, file);
		console.log(`▶ Running Feature Test Script: ${file}...`);
		try {
			execSync(`bun run "${filePath}"`, { stdio: "inherit" });
			passedCount++;
			console.log(`✅ [PASS] ${file}\n`);
		} catch (err) {
			failedCount++;
			console.error(`❌ [FAIL] ${file}\n`);
		}
	}

	console.log("==================================================");
	console.log(`RESULTS: ${passedCount} Passed | ${failedCount} Failed`);
	console.log("==================================================");

	console.log(
		"\n🌱 Re-seeding database with active group classes & slots for UI testing...",
	);
	try {
		const seedScript = path.join(testsDir, "seed-group-classes.ts");
		execSync(`bun run "${seedScript}"`, { stdio: "inherit" });
		console.log(
			"✅ Database re-seeded successfully! Active classes are ready in dashboard.\n",
		);
	} catch (err) {
		console.error("⚠️ Failed to re-seed active classes:", err);
	}

	if (failedCount > 0) {
		process.exit(1);
	}
}

runRegressionSuite().catch((err) => {
	console.error("Regression suite runner encountered error:", err);
	process.exit(1);
});
