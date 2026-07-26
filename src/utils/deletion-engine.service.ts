import mongoose from "mongoose";
import { deleteFromS3 } from "./s3.service";
import User from "../models/User";
import ConsentForm from "../models/ConsentForm";
import HealthGoals from "../models/HealthGoals";
import HealthMarkers from "../models/HealthMarkers";
import BcaMetric from "../models/BcaMetric";
import MedicalReport from "../models/MedicalReport";
import Schedule from "../models/Schedule";
import SetLog from "../models/SetLog";
import WorkoutExercise from "../models/WorkoutExercise";
import WorkoutSession from "../models/WorkoutSession";
import WorkoutPlanAssignment from "../models/WorkoutPlanAssignment";
import NutritionAdherenceDaily from "../models/nutrition-adherence.model";
import NutritionHydrationLog from "../models/nutrition-hydration.model";
import NutritionMealLog from "../models/nutrition-meal-log.model";
import UserNutritionPlan from "../models/nutrition-plan.model";
import NutritionProfile from "../models/nutrition-profile.model";
import NutritionProgress from "../models/nutrition-progress.model";

/**
 * Permanently deletes all personal data (consent, health goals/markers, BCA metrics,
 * medical reports, schedules, workouts, sets, nutrition progress/logs) and deletes files from S3.
 * Anonymizes the core User document to maintain legal/compliance transaction continuity.
 *
 * @param userId - MongoDB ID of the user to anonymize and delete data for.
 */
export const deleteAndAnonymizeUserData = async (
	userId: string | mongoose.Types.ObjectId,
): Promise<void> => {
	const userObjectId =
		typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

	console.log(
		`[DELETION_ENGINE] Starting data deletion and anonymization for user ID: ${userObjectId.toString()}`,
	);

	// 1. S3 File Cleanup: Fetch all MedicalReport documents for the user and delete their S3 keys
	try {
		const medicalReports = await MedicalReport.find({ userId: userObjectId });
		for (const report of medicalReports) {
			if (report.s3Key) {
				console.log(
					`[DELETION_ENGINE] Deleting S3 file with key: ${report.s3Key}`,
				);
				try {
					await deleteFromS3(report.s3Key);
				} catch (s3Err) {
					console.error(
						`[DELETION_ENGINE] Failed to delete key ${report.s3Key} from S3:`,
						s3Err,
					);
					// Proceed anyway: we don't want to fail database anonymization because of S3 hiccups
				}
			}
		}
	} catch (err) {
		console.error(
			"[DELETION_ENGINE] Error scanning medical reports for S3 deletion:",
			err,
		);
	}

	// 2. Hard-Delete User Onboarding & Health Data from MongoDB
	console.log(
		"[DELETION_ENGINE] Deleting onboarding, consent, health records, metrics, and reports...",
	);
	await Promise.all([
		ConsentForm.deleteMany({ userId: userObjectId }),
		HealthGoals.deleteMany({ userId: userObjectId }),
		HealthMarkers.deleteMany({ userId: userObjectId }),
		BcaMetric.deleteMany({ userId: userObjectId }),
		MedicalReport.deleteMany({ userId: userObjectId }),
		Schedule.deleteMany({ user: userObjectId }),
	]);

	// 3. Hard-Delete Workout Sessions and Logs
	console.log("[DELETION_ENGINE] Deleting workout history and logs...");
	try {
		const sessions = await WorkoutSession.find({ userId: userObjectId });
		const sessionIds = sessions.map((s) => s._id);

		if (sessionIds.length > 0) {
			const exercises = await WorkoutExercise.find({
				session: { $in: sessionIds },
			});
			const exerciseIds = exercises.map((e) => e._id);

			if (exerciseIds.length > 0) {
				await SetLog.deleteMany({ workoutExercise: { $in: exerciseIds } });
				await WorkoutExercise.deleteMany({ session: { $in: sessionIds } });
			}
			await WorkoutSession.deleteMany({ userId: userObjectId });
		}
		await WorkoutPlanAssignment.deleteMany({ userId: userObjectId });
	} catch (err) {
		console.error(
			"[DELETION_ENGINE] Error deleting workout sessions and logs:",
			err,
		);
	}

	// 4. Hard-Delete Nutrition Data
	console.log(
		"[DELETION_ENGINE] Deleting nutrition plans, hydration, meal logs, progress, profile...",
	);
	await Promise.all([
		NutritionAdherenceDaily.deleteMany({ userId: userObjectId }),
		NutritionHydrationLog.deleteMany({ userId: userObjectId }),
		NutritionMealLog.deleteMany({ userId: userObjectId }),
		UserNutritionPlan.deleteMany({ userId: userObjectId }),
		NutritionProfile.deleteMany({ userId: userObjectId }),
		NutritionProgress.deleteMany({ userId: userObjectId }),
	]);

	// 5. Anonymize User Document
	console.log("[DELETION_ENGINE] Anonymizing user profile...");
	const anonymizedPhone = `deleted_${userObjectId.toString()}`;

	const updateResult = await User.findByIdAndUpdate(userObjectId, {
		$set: {
			username: "Deleted User",
			phone: anonymizedPhone,
			onboarded: false,
			fcmTokens: [],
			onboardingStatus: {
				currentStep: "HEALTH_MARKERS",
				completedSteps: [],
				healthMarkersCompleted: false,
				healthGoalsCompleted: false,
				consentCompleted: false,
				reportsUploaded: false,
				sportsScientistBooked: false,
				nutritionistBooked: false,
				onboardingCompleted: false,
				startedAt: new Date(),
				completedAt: undefined,
			},
		},
		$unset: {
			email: 1,
			firebaseUid: 1,
			passwordHash: 1,
			goal: 1,
			healthGoals: 1,
			dateOfBirth: 1,
			emergencyContact: 1,
			address: 1,
		},
	});

	if (!updateResult) {
		console.warn(
			`[DELETION_ENGINE] User document not found for anonymization: ${userObjectId.toString()}`,
		);
	} else {
		console.log(
			`[DELETION_ENGINE] Data deletion and anonymization completed for user ID: ${userObjectId.toString()}`,
		);
	}
};
