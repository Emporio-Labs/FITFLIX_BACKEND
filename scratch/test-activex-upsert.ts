import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import BcaMetric from "../src/models/BcaMetric";
import { upsertBcaRecordForUser, mapActiveXRecordToBcaMetric } from "../src/utils/activex.service";

config();

async function testUpsert() {
	await connectDB();
	const user = await User.findOne({ phone: { $exists: true, $ne: "" } });
	if (!user) {
		console.log("No user found");
		process.exit(0);
	}

	console.log(`Testing with user: ${user.username} (${user._id})`);
	console.log("Current activeXTestCompleted:", user.onboardingStatus?.activeXTestCompleted);

	// Sample real record shape from ActiveX machine
	const sampleRecord = {
		phone: user.phone,
		insertionDate: new Date().toISOString(),
		ppAge: 26,
		ppSex: "MALE",
		ppWeightKg: 74.5,
		ppHeightCm: 178.0,
		ppBMI: 23.5,
		ppHeartRate: 72,
		ppBodyfatKg: 13.2,
		ppFat: 17.7,
		ppBodySkeletalKg: 34.8,
		ppMuscleKg: 58.1,
		ppWaterKg: 42.5,
		ppProteinKg: 11.2,
		ppMineralKg: 3.8,
		ppVisceralFat: 4,
		ppBMR: 1680,
		ppBodyAge: 24,
		ppIdealWeightKg: 72.0,
		ppControlWeightKg: -2.5,
	};

	console.log("\nMapping record to BcaMetric model...");
	const mapped = mapActiveXRecordToBcaMetric(sampleRecord, user._id as mongoose.Types.ObjectId);
	console.log("Mapped payload:", JSON.stringify(mapped, null, 2));

	console.log("\nTesting upsertBcaRecordForUser...");
	await upsertBcaRecordForUser(user._id as mongoose.Types.ObjectId, sampleRecord);

	const updatedUser = await User.findById(user._id).select("onboardingStatus");
	console.log("\nUpdated User activeXTestCompleted:", updatedUser?.onboardingStatus?.activeXTestCompleted);

	const storedMetric = await BcaMetric.findOne({ userId: user._id }).sort({ recordedAt: -1 });
	console.log("Stored BcaMetric from DB (Weight, BMI, Body Fat %):", {
		weight: storedMetric?.vitals?.weight_kg,
		bmi: storedMetric?.vitals?.bmi,
		bodyFat: storedMetric?.bodyComposition?.body_fat_percent,
		skeletalMuscle: storedMetric?.bodyComposition?.skeletal_muscle_mass_kg,
		recordedAt: storedMetric?.recordedAt,
	});

	console.log("\n✅ Test completed successfully!");
	process.exit(0);
}

testUpsert().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
