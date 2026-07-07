import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import DeletionRequest from "../src/models/DeletionRequest";
import HealthMarkers from "../src/models/HealthMarkers";
import ConsentForm from "../src/models/ConsentForm";
import WorkoutSession from "../src/models/WorkoutSession";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import MedicalReport from "../src/models/MedicalReport";
import Invoice from "../src/models/Invoice";
import { deleteAndAnonymizeUserData } from "../src/utils/deletion-engine.service";
import { DeletionRequestStatus } from "../src/models/Enums";

config();

async function main() {
	console.log("=== Starting Account Deletion & Anonymization Test Flow ===");

	try {
		await connectDB();
		console.log("Connected to MongoDB database.");

		// 1. Create a mock user
		console.log("\n[1/5] Creating mock user...");
		const uniqueSuffix = Date.now().toString();
		const testUser = await User.create({
			username: `Test User ${uniqueSuffix}`,
			phone: `99999${uniqueSuffix.slice(-5)}`,
			email: `testuser_${uniqueSuffix}@example.com`,
			firebaseUid: `firebase_test_${uniqueSuffix}`,
			age: 28,
			gender: "Male",
			onboarded: true,
			dateOfBirth: new Date("1998-01-01"),
			emergencyContact: "9876543210",
			address: "123 Test Street, Fitness City",
			goal: "Build Muscle",
			healthGoals: ["Hypertrophy", "Strength"],
		});
		const userId = testUser._id;
		console.log(`Mock user created. ID: ${userId.toString()}`);

		// 2. Create associated personal and fitness/nutrition data
		console.log(
			"\n[2/5] Seeding personal health, fitness, consent, and nutrition data...",
		);

		const markers = await HealthMarkers.create({
			userId,
			weight: 80,
			height: 180,
			bmi: 24.7,
			activityLevel: "Active",
		});

		const consent = await ConsentForm.create({
			userId,
			consents: [
				{
					type: "WELLNESS_SERVICES",
					accepted: true,
					acceptedAt: new Date(),
				},
			],
			ipAddress: "127.0.0.1",
		});

		const workout = await WorkoutSession.create({
			userId: userId,
			status: "Completed",
			date: new Date(),
		});

		const nutritionPlan = await UserNutritionPlan.create({
			userId,
			name: "Test Nutrition Plan",
			nutritionistId: new mongoose.Types.ObjectId(),
			goal: "MuscleGain",
			status: "Active",
			targetCaloriesKcal: 3000,
			targetMacros: {
				proteinG: 160,
				carbsG: 400,
				fatG: 80,
			},
			durationDays: 84,
		});

		const medicalReport = await MedicalReport.create({
			userId,
			reportName: "Blood Test",
			reportType: "Biochemistry",
			reportUrl: "https://fitflix-storage.s3.amazonaws.com/test-key.pdf",
			s3Key: "test-reports/blood_test.pdf",
		});

		// 3. Create a legal/financial transactional document (Invoice) to verify it is NOT deleted
		console.log(
			"\n[3/5] Creating mock Invoice (legal/compliance/accounting record)...",
		);
		const invoice = await Invoice.create({
			userId,
			invoiceNumber: `INV-${uniqueSuffix}`,
			subtotal: 5000,
			total: 5000,
			paymentStatus: "PAID",
			paymentMethod: "UPI",
			items: [
				{
					name: "Fitflix Premium Membership - 12 Months",
					price: 5000,
					quantity: 1,
				},
			],
			planSnapshot: {
				name: "Premium Yearly",
				durationInDays: 365,
				price: 5000,
				includedCredits: 100,
			},
		});
		console.log(`Invoice created. ID: ${invoice._id.toString()}`);

		// 4. Create Deletion Request
		console.log("\n[4/5] Creating Deletion Request...");
		const deletionRequest = await DeletionRequest.create({
			userId,
			fullName: testUser.username,
			email: testUser.email,
			phone: testUser.phone,
			reason: "Testing the deletion flow",
			status: DeletionRequestStatus.Pending,
			ipAddress: "127.0.0.1",
			userAgent: "Test Script Runner",
		});
		console.log(
			`Deletion request logged. ID: ${deletionRequest._id.toString()}`,
		);

		// 5. Execute deletion and anonymization engine (simulating admin processing request)
		console.log(
			"\n[5/5] Invoking data deletion and anonymization engine...",
		);
		await deleteAndAnonymizeUserData(userId);

		// 6. Verification
		console.log("\n=== VERIFICATION RESULTS ===");

		// Verify personal models are deleted
		const markersCheck = await HealthMarkers.findOne({ userId });
		const consentCheck = await ConsentForm.findOne({ userId });
		const workoutCheck = await WorkoutSession.findOne({ userId });
		const nutritionPlanCheck = await UserNutritionPlan.findOne({ userId });
		const medicalReportCheck = await MedicalReport.findOne({ userId });

		console.log(
			`- HealthMarkers deleted? ${markersCheck === null ? "YES (Pass)" : "NO (Fail)"}`,
		);
		console.log(
			`- ConsentForm deleted? ${consentCheck === null ? "YES (Pass)" : "NO (Fail)"}`,
		);
		console.log(
			`- WorkoutSession deleted? ${workoutCheck === null ? "YES (Pass)" : "NO (Fail)"}`,
		);
		console.log(
			`- NutritionPlan deleted? ${nutritionPlanCheck === null ? "YES (Pass)" : "NO (Fail)"}`,
		);
		console.log(
			`- MedicalReport deleted? ${medicalReportCheck === null ? "YES (Pass)" : "NO (Fail)"}`,
		);

		// Verify User document anonymized
		const anonymizedUser = await User.findById(userId);
		if (!anonymizedUser) {
			console.log(
				"- User document check: FAIL (Document completely deleted instead of anonymized!)",
			);
		} else {
			const isNameAnonymized = anonymizedUser.username === "Deleted User";
			const isPhoneAnonymized =
				anonymizedUser.phone === `deleted_${userId.toString()}`;
			const isEmailRemoved = anonymizedUser.email === undefined;
			const isFirebaseUidRemoved = anonymizedUser.firebaseUid === undefined;
			const isPasswordHashRemoved = anonymizedUser.passwordHash === undefined;
			const isProfileWiped =
				anonymizedUser.goal === undefined &&
				anonymizedUser.address === undefined &&
				anonymizedUser.dateOfBirth === undefined;

			console.log(
				`- Username anonymized? ${isNameAnonymized ? "YES (Pass)" : "NO (Fail)"} (${anonymizedUser.username})`,
			);
			console.log(
				`- Phone number anonymized? ${isPhoneAnonymized ? "YES (Pass)" : "NO (Fail)"} (${anonymizedUser.phone})`,
			);
			console.log(
				`- Email removed? ${isEmailRemoved ? "YES (Pass)" : "NO (Fail)"}`,
			);
			console.log(
				`- Firebase UID removed? ${isFirebaseUidRemoved ? "YES (Pass)" : "NO (Fail)"}`,
			);
			console.log(
				`- Profile fields wiped? ${isProfileWiped ? "YES (Pass)" : "NO (Fail)"}`,
			);
		}

		// Verify Invoice is RETAINED for accounting/compliance
		const invoiceCheck = await Invoice.findById(invoice._id);
		console.log(
			`- Invoice record retained for compliance/accounting? ${invoiceCheck !== null ? "YES (Pass)" : "NO (Fail)"}`,
		);
		if (invoiceCheck) {
			console.log(
				`  (Invoice still references user ID: ${invoiceCheck.userId?.toString()})`,
			);
		}

		// Clean up invoice and request to keep database clean
		console.log(
			"\n[Clean-up] Removing test Invoice and DeletionRequest...",
		);
		await Invoice.findByIdAndDelete(invoice._id);
		await DeletionRequest.findByIdAndDelete(deletionRequest._id);
		await User.findByIdAndDelete(userId);
		console.log("Database clean-up finished.");

		console.log("\n=== Test completed successfully ===");
	} catch (error) {
		console.error("Test execution failed with error:", error);
	} finally {
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB.");
	}
}

await main();
