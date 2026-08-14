import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import { hashPassword } from "../src/utils/password";
import { Gender, OnboardingStep } from "../src/models/Enums";

config();

async function main() {
	console.log("Connecting to MongoDB...");
	try {
		await connectDB();
		console.log("✅ Database is connected properly! Connection state:", mongoose.connection.readyState);

		const testEmail = "user@fitflix.com";
		const testPassword = "User@12345";
		const passwordHash = await hashPassword(testPassword);

		let user = await User.findOne({ email: testEmail });
		if (user) {
			console.log(`Found existing user with email ${testEmail}, updating passwordHash...`);
			user.passwordHash = passwordHash;
			await user.save();
		} else {
			console.log(`Creating new user account for ${testEmail}...`);
			user = await User.create({
				username: "Test User",
				phone: "9998887770",
				email: testEmail,
				age: 25,
				gender: Gender.Male,
				onboarded: true,
				passwordHash: passwordHash,
				onboardingStatus: {
					currentStep: OnboardingStep.HEALTH_MARKERS,
					completedSteps: [
						OnboardingStep.HEALTH_MARKERS,
						OnboardingStep.HEALTH_GOALS,
						OnboardingStep.CONSENT,
						OnboardingStep.REPORTS_UPLOAD,
					],
					healthMarkersCompleted: true,
					healthGoalsCompleted: true,
					consentCompleted: true,
					reportsUploaded: true,
					onboardingCompleted: true,
					startedAt: new Date(),
					completedAt: new Date(),
				},
			});
		}

		console.log("✅ Test User Ready!");
		console.log(`Email: ${testEmail}`);
		console.log(`Password: ${testPassword}`);
		console.log(`User ID: ${user._id}`);
	} catch (error) {
		console.error("❌ Database connection error:", error);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
