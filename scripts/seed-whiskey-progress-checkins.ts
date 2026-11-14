import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import NutritionProgress from "../src/models/nutrition-progress.model";
import { ProgressRecordedBy } from "../src/models/Enums";

async function main() {
	console.log("=== FITFLIX: Seeding 8 Weeks Check-In Data for whiskey@gmail.com ===");

	await connectDB();

	const user = await User.findOne({ email: "whiskey@gmail.com" });
	if (!user) {
		console.error("❌ User whiskey@gmail.com not found!");
		process.exit(1);
	}

	const userId = user._id;
	console.log(`✅ Found user whiskey@gmail.com (ID: ${userId.toString()})`);

	// Delete existing manual progress entries for whiskey to have a clean state
	const deleted = await NutritionProgress.deleteMany({ userId, recordedBy: ProgressRecordedBy.User });
	console.log(`🧹 Cleaned up ${deleted.deletedCount} existing manual check-ins`);

	const now = new Date();
	const checkinsData = [
		{
			daysAgo: 56,
			weightKg: 80.2,
			bodyFatPct: 18.5,
			measurements: {
				neckCm: 39.5,
				shouldersCm: 118.0,
				chestCm: 100.0,
				bicepLeftCm: 34.0,
				bicepRightCm: 34.2,
				armCm: 34.1,
				forearmLeftCm: 29.0,
				forearmRightCm: 29.2,
				waistCm: 88.0,
				hipCm: 101.0,
				thighLeftCm: 58.0,
				thighRightCm: 58.0,
				thighCm: 58.0,
				calfLeftCm: 37.0,
				calfRightCm: 37.0,
			},
			note: "Starting new nutrition block and progressive overload phase.",
		},
		{
			daysAgo: 49,
			weightKg: 79.7,
			bodyFatPct: 18.2,
			measurements: {
				neckCm: 39.3,
				shouldersCm: 118.5,
				chestCm: 100.0,
				bicepLeftCm: 34.0,
				bicepRightCm: 34.3,
				armCm: 34.1,
				forearmLeftCm: 29.0,
				forearmRightCm: 29.2,
				waistCm: 87.0,
				hipCm: 101.0,
				thighLeftCm: 58.0,
				thighRightCm: 58.0,
				thighCm: 58.0,
				calfLeftCm: 37.0,
				calfRightCm: 37.0,
			},
			note: "Consistent water intake, feeling lighter.",
		},
		{
			daysAgo: 42,
			weightKg: 79.1,
			bodyFatPct: 17.9,
			measurements: {
				neckCm: 39.2,
				shouldersCm: 118.8,
				chestCm: 100.5,
				bicepLeftCm: 34.2,
				bicepRightCm: 34.5,
				armCm: 34.3,
				forearmLeftCm: 29.2,
				forearmRightCm: 29.4,
				waistCm: 86.5,
				hipCm: 100.5,
				thighLeftCm: 58.0,
				thighRightCm: 58.0,
				thighCm: 58.0,
				calfLeftCm: 37.0,
				calfRightCm: 37.0,
			},
			note: "Post refeed check-in, energy levels high.",
		},
		{
			daysAgo: 35,
			weightKg: 78.6,
			bodyFatPct: 17.6,
			measurements: {
				neckCm: 39.0,
				shouldersCm: 119.0,
				chestCm: 101.0,
				bicepLeftCm: 34.5,
				bicepRightCm: 34.7,
				armCm: 34.6,
				forearmLeftCm: 29.4,
				forearmRightCm: 29.5,
				waistCm: 85.5,
				hipCm: 100.0,
				thighLeftCm: 57.5,
				thighRightCm: 57.5,
				thighCm: 57.5,
				calfLeftCm: 37.1,
				calfRightCm: 37.1,
			},
			note: "Hitting 140g protein target daily.",
		},
		{
			daysAgo: 28,
			weightKg: 78.0,
			bodyFatPct: 17.2,
			measurements: {
				neckCm: 38.9,
				shouldersCm: 119.2,
				chestCm: 101.5,
				bicepLeftCm: 34.8,
				bicepRightCm: 35.0,
				armCm: 34.9,
				forearmLeftCm: 29.5,
				forearmRightCm: 29.7,
				waistCm: 84.5,
				hipCm: 100.0,
				thighLeftCm: 57.5,
				thighRightCm: 57.5,
				thighCm: 57.5,
				calfLeftCm: 37.1,
				calfRightCm: 37.1,
			},
			note: "Waist down 3.5cm from baseline! Great motivation.",
		},
		{
			daysAgo: 21,
			weightKg: 77.4,
			bodyFatPct: 16.8,
			measurements: {
				neckCm: 38.8,
				shouldersCm: 119.5,
				chestCm: 102.0,
				bicepLeftCm: 35.0,
				bicepRightCm: 35.2,
				armCm: 35.1,
				forearmLeftCm: 29.7,
				forearmRightCm: 29.8,
				waistCm: 83.5,
				hipCm: 99.5,
				thighLeftCm: 57.0,
				thighRightCm: 57.0,
				thighCm: 57.0,
				calfLeftCm: 37.1,
				calfRightCm: 37.1,
			},
			note: "Arms and chest holding size while waist drops.",
		},
		{
			daysAgo: 14,
			weightKg: 76.8,
			bodyFatPct: 16.5,
			measurements: {
				neckCm: 38.6,
				shouldersCm: 119.8,
				chestCm: 102.5,
				bicepLeftCm: 35.2,
				bicepRightCm: 35.5,
				armCm: 35.3,
				forearmLeftCm: 29.8,
				forearmRightCm: 30.0,
				waistCm: 82.5,
				hipCm: 99.0,
				thighLeftCm: 57.0,
				thighRightCm: 57.0,
				thighCm: 57.0,
				calfLeftCm: 37.2,
				calfRightCm: 37.2,
			},
			note: "Sunday morning check-in after 8 hrs sleep.",
		},
		{
			daysAgo: 3,
			weightKg: 76.2,
			bodyFatPct: 16.1,
			measurements: {
				neckCm: 38.5,
				shouldersCm: 120.0,
				chestCm: 103.0,
				bicepLeftCm: 35.5,
				bicepRightCm: 35.7,
				armCm: 35.6,
				forearmLeftCm: 30.0,
				forearmRightCm: 30.2,
				waistCm: 81.5,
				hipCm: 98.5,
				thighLeftCm: 56.5,
				thighRightCm: 56.5,
				thighCm: 56.5,
				calfLeftCm: 37.2,
				calfRightCm: 37.2,
			},
			note: "WHR is now 0.83 (Optimal clinical range). Feeling sharp.",
		},
	];

	for (const item of checkinsData) {
		const recordedAt = new Date(now.getTime() - item.daysAgo * 24 * 60 * 60 * 1000);
		await NutritionProgress.create({
			userId,
			recordedAt,
			weightKg: item.weightKg,
			bodyFatPct: item.bodyFatPct,
			measurements: item.measurements,
			note: item.note,
			recordedBy: ProgressRecordedBy.User,
		});
	}

	console.log(`🎉 Successfully seeded ${checkinsData.length} weekly check-in records for whiskey@gmail.com!`);
	console.log(`Baseline: 80.2 kg -> Latest: 76.2 kg (Δ -4.0 kg). Goal: 74.0 kg.`);
	console.log(`Waist: 88 cm -> 81.5 cm. WHR: 0.87 -> 0.83.`);

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error("❌ Seed failed:", err);
	process.exit(1);
});
