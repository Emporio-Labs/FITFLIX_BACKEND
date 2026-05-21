import { config } from "dotenv";
import { OnboardingStep } from "../src/models/Enums";
import User from "../src/models/User";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const ALL_STEPS = [
	OnboardingStep.HEALTH_MARKERS,
	OnboardingStep.HEALTH_GOALS,
	OnboardingStep.CONSENT,
	OnboardingStep.REPORT_UPLOAD,
	OnboardingStep.SPORTS_SCIENTIST_BOOKING,
	OnboardingStep.NUTRITIONIST_BOOKING,
	OnboardingStep.COMPLETED,
];

async function main() {
	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const users = await User.find({}).select("_id onboarded onboardingStatus");
		let updatedCount = 0;
		let skippedCount = 0;

		for (const user of users) {
			if (user.onboardingStatus?.currentStep) {
				skippedCount++;
				continue;
			}

			const isOnboarded = user.onboarded === true;

			const update = isOnboarded
				? {
						$set: {
							"onboardingStatus.currentStep": OnboardingStep.COMPLETED,
							"onboardingStatus.completedSteps": ALL_STEPS,
							"onboardingStatus.healthMarkersCompleted": true,
							"onboardingStatus.healthGoalsCompleted": true,
							"onboardingStatus.consentCompleted": true,
							"onboardingStatus.reportsUploaded": true,
							"onboardingStatus.sportsScientistBooked": true,
							"onboardingStatus.nutritionistBooked": true,
							"onboardingStatus.onboardingCompleted": true,
							"onboardingStatus.completedAt": user.get("updatedAt") ?? new Date(),
						},
					}
				: {
						$set: {
							"onboardingStatus.currentStep":
								OnboardingStep.HEALTH_MARKERS,
							"onboardingStatus.completedSteps": [],
							"onboardingStatus.healthMarkersCompleted": false,
							"onboardingStatus.healthGoalsCompleted": false,
							"onboardingStatus.consentCompleted": false,
							"onboardingStatus.reportsUploaded": false,
							"onboardingStatus.sportsScientistBooked": false,
							"onboardingStatus.nutritionistBooked": false,
							"onboardingStatus.onboardingCompleted": false,
						},
					};

			const userId = user._id.toString();

			if (dryRun) {
				console.log(
					`[DRY RUN] User ${userId}: onboarded=${isOnboarded} → would set currentStep=${isOnboarded ? "COMPLETED" : "HEALTH_MARKERS"}`,
				);
			} else {
				await User.findByIdAndUpdate(user._id, update);
			}

			updatedCount++;
		}

		console.log(
			`\n${dryRun ? "[DRY RUN] " : ""}Migration complete: ${updatedCount} users updated, ${skippedCount} skipped (already migrated)`,
		);
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

main();
