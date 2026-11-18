import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import Membership from "../src/models/Membership";
import MembershipPlan from "../src/models/MembershipPlan";
import CreditTransaction from "../src/models/CreditTransaction";
import Location from "../src/models/Location";
import HealthMarkers, { ActivityLevel } from "../src/models/HealthMarkers";
import HealthGoals, { WorkoutExperience } from "../src/models/HealthGoals";
import ConsentForm from "../src/models/ConsentForm";
import MedicalReport from "../src/models/MedicalReport";
import BcaMetric from "../src/models/BcaMetric";
import GymVisit from "../src/models/GymVisit";
import NutritionistBooking from "../src/models/NutritionistBooking";
import FitflixEvent from "../src/models/FitflixEvent";
import EventRegistration from "../src/models/EventRegistration";
import MemberGoal from "../src/models/MemberGoal";
import Habit from "../src/models/Habit";
import HabitLog from "../src/models/HabitLog";
import SleepLog, { SleepSource } from "../src/models/sleep-log.model";
import ProgressPhoto, { PhotoPose } from "../src/models/ProgressPhoto";
import Post from "../src/models/Post";
import ChatConversation from "../src/models/ChatConversation";
import ChatMessage from "../src/models/ChatMessage";
import Trainer from "../src/models/Trainer";
import Class from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import Booking from "../src/models/Bookings";
import Therapy from "../src/models/Therapy";
import Slot from "../src/models/Slots";
import WorkoutPlanAssignment from "../src/models/WorkoutPlanAssignment";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import {
	AppointmentMode,
	BookingStatus,
	CommunityRole,
	ConsentType,
	CreditTransactionSource,
	CreditTransactionType,
	EventStatus,
	EventType,
	ExpertType,
	GoalStatus,
	GoalType,
	HabitCategory,
	HabitFrequency,
	MembershipStatus,
	NutritionGoal,
	NutritionPlanStatus,
	NutritionistBookingStatus,
	OnboardingStep,
	PostStatus,
	PostVisibility,
} from "../src/models/Enums";
import { hashPassword } from "../src/utils/password";

config();

const PERSONA_PHONES = [
	"+919999900001", // P1 New user
	"+919999900002", // P2 Visitor
	"+919999900003", // P3 Active member
	"+919999900004", // P4 Expired
	"+919999900005", // P5 Onboarding not started
	"+919999900006", // P5b App setup done
	"+919999900007", // P6 Paused
	"+919999900008", // P4b Active, 0 credits
	"+918919726698", // Configured Firebase test number alias
];

async function seedPersonas() {
	console.log("Connecting to database...");
	await connectDB();

	const dbName = mongoose.connection.db?.databaseName;
	console.log(`Database connected. Current DB Name: "${dbName}"`);

	if (dbName !== "fitflix_qa") {
		console.error(
			`FATAL: Refusing to seed! Target DB is "${dbName}". Harness rules strictly require "fitflix_qa".`,
		);
		process.exit(1);
	}

	console.log("Hard rule verified: operating safely on database 'fitflix_qa'.");

	// Ensure at least one primary Location exists
	let location = await Location.findOne({ code: "sainikpuri" });
	if (!location) {
		location = await Location.create({
			name: "Fitflix Sainikpuri",
			code: "sainikpuri",
			address: {
				line1: "Fitflix Club",
				city: "Hyderabad",
				state: "Telangana",
				pincode: "500094",
				country: "India",
			},
			phone: "+91 91234 56789",
			email: "sainikpuri@fitflix.in",
		});
	}
	const locationId = location._id;

	// Ensure a trainer exists for PT and class assignment
	let trainer = await Trainer.findOne({ email: "coach.qa@fitflix.in" });
	if (!trainer) {
		trainer = await Trainer.create({
			trainerName: "Coach Vikram QA",
			email: "coach.qa@fitflix.in",
			phone: "+91 98888 77777",
			passwordHash: await hashPassword("Coach@1234"),
			specialities: ["Strength & Conditioning", "Hypertrophy"],
			bio: "Senior Strength & Conditioning Specialist at Fitflix",
			isActive: true,
			locationId,
		});
	}

	// 1. Clean up existing records for these phones
	console.log("Cleaning up previous QA personas...");
	const existingUsers = await User.find({ phone: { $in: PERSONA_PHONES } });
	const userIds = existingUsers.map((u) => u._id);

	if (userIds.length > 0) {
		await Promise.all([
			Membership.deleteMany({ user: { $in: userIds } }),
			CreditTransaction.deleteMany({ user: { $in: userIds } }),
			HealthMarkers.deleteMany({ userId: { $in: userIds } }),
			HealthGoals.deleteMany({ userId: { $in: userIds } }),
			ConsentForm.deleteMany({ userId: { $in: userIds } }),
			MedicalReport.deleteMany({ userId: { $in: userIds } }),
			BcaMetric.deleteMany({ userId: { $in: userIds } }),
			GymVisit.deleteMany({ userId: { $in: userIds } }),
			NutritionistBooking.deleteMany({ userId: { $in: userIds } }),
			EventRegistration.deleteMany({ userId: { $in: userIds } }),
			MemberGoal.deleteMany({ userId: { $in: userIds } }),
			Habit.deleteMany({ userId: { $in: userIds } }),
			HabitLog.deleteMany({ userId: { $in: userIds } }),
			SleepLog.deleteMany({ userId: { $in: userIds } }),
			ProgressPhoto.deleteMany({ userId: { $in: userIds } }),
			Post.deleteMany({ authorId: { $in: userIds } }),
			Booking.deleteMany({ user: { $in: userIds } }),
			WorkoutPlanAssignment.deleteMany({ userId: { $in: userIds } }),
			UserNutritionPlan.deleteMany({ userId: { $in: userIds } }),
			User.deleteMany({ _id: { $in: userIds } }),
		]);
	}

	// Ensure base MembershipPlans exist
	let goldPlan = await MembershipPlan.findOne({ name: "QA Gold 47" });
	if (!goldPlan) {
		goldPlan = await MembershipPlan.create({
			name: "QA Gold 47",
			description: "Full access membership for automated testing",
			price: 15000,
			currency: "INR",
			creditsIncluded: 50,
			ptSessionsIncluded: 14,
			durationMonths: 3,
			durationDays: 47,
			active: true,
			locationId,
		});
	}

	let silverPlan = await MembershipPlan.findOne({ name: "QA Silver Expired" });
	if (!silverPlan) {
		silverPlan = await MembershipPlan.create({
			name: "QA Silver Expired",
			description: "Expired membership for testing renewal guards",
			price: 8000,
			currency: "INR",
			creditsIncluded: 20,
			durationMonths: 1,
			active: true,
			locationId,
		});
	}

	console.log("Seeding personas...");
	const now = new Date();
	const personaTable: any[] = [];

	// --- P1: Brand-new user (+919999900001) ---
	// Plan says: nothing in DB; registration creates it via /phone-register
	personaTable.push({
		ID: "P1",
		Phone: "+919999900001",
		Name: "QA New Ira (Unregistered)",
		Status: "Unregistered (Test creates it)",
		Sentinels: "None",
	});

	// --- P2: Visitor (+919999900002) ---
	const userP2 = await User.create({
		username: "QA Visitor Ravi",
		phone: "+919999900002",
		phoneVerified: true,
		onboarded: true,
		homeLocationId: locationId,
		onboardingStatus: {
			onboardingCompleted: true,
			appOnboardingCompleted: true,
		},
	});
	personaTable.push({
		ID: "P2",
		Phone: "+919999900002",
		Name: userP2.username,
		Status: "Visitor (No Plan)",
		Sentinels: "Name: QA Visitor Ravi",
	});

	// --- P3: Active Member Full (+919999900003 & alias +918919726698) ---
	async function createActiveMember(phone: string, label: string) {
		const user = await User.create({
			username: "QA Member Maya",
			phone,
			phoneVerified: true,
			age: 28,
			gender: "Female",
			onboarded: true,
			homeLocationId: locationId,
			membershipStatus: "ACTIVE",
			onboardingStatus: {
				currentStep: OnboardingStep.COMPLETED,
				completedSteps: Object.values(OnboardingStep),
				onboardingCompleted: true,
				appOnboardingCompleted: true,
				healthMarkersCompleted: true,
				healthGoalsCompleted: true,
				consentCompleted: true,
				reportsUploaded: true,
				nutritionistBooked: true,
			},
		});

		// Membership: QA Gold 47 ending in 47 days, credits 47, PT 7/14
		const endDate47 = new Date(now.getTime() + 47 * 24 * 3600 * 1000);
		const membership = await Membership.create({
			user: user._id,
			planName: "QA Gold 47",
			planId: goldPlan!._id,
			category: "GENERAL_MEMBERSHIP",
			creditsIncluded: 50,
			creditsRemaining: 47, // Sentinel 47
			ptSessionsIncluded: 14, // Sentinel 14
			ptSessionsRemaining: 7, // Sentinel 7 (7/14)
			assignedTrainerId: trainer!._id,
			assignedTrainerName: trainer!.trainerName,
			status: MembershipStatus.Active,
			price: 15000,
			startDate: new Date(now.getTime() - 10 * 24 * 3600 * 1000),
			endDate: endDate47,
			locationId,
		});

		// Credit ledger transaction
		await CreditTransaction.create({
			user: user._id,
			membership: membership._id,
			amount: 47,
			type: CreditTransactionType.AdminTopUp,
			sourceType: CreditTransactionSource.Admin,
			reason: "Initial QA Seed Allocation",
			locationId,
		});

		// HealthMarkers: weight 73.7 kg (Sentinel)
		await HealthMarkers.create({
			userId: user._id,
			weight: 73.7, // Sentinel
			height: 168,
			bmi: 26.1,
			activityLevel: ActivityLevel.Moderate,
			sleepHours: 7.5,
		});

		// HealthGoals
		await HealthGoals.create({
			userId: user._id,
			goals: ["Weight Loss", "Cardiovascular Endurance"],
			targetWeight: 65,
			workoutExperience: WorkoutExperience.Intermediate,
			foodPreferences: ["High Protein", "Vegetarian"],
		});

		// BCA Metric: 73.7 kg
		await BcaMetric.create({
			userId: user._id,
			recordedAt: new Date(now.getTime() - 2 * 24 * 3600 * 1000),
			receivedAt: new Date(),
			vitals: {
				weight_kg: 73.7,
				height_cm: 168,
				bmi: 26.1,
				pulse: 72,
				heart_rate: 72,
			},
			bodyComposition: {
				body_fat_percent: 24.2,
				skeletal_muscle_mass_kg: 28.5,
				basal_metabolic_rate_cal: 1480,
				visceral_fat: 6,
			},
		});

		// Gym visits (5 visits)
		for (let v = 1; v <= 5; v++) {
			await GymVisit.create({
				userId: user._id,
				locationId,
				checkInAt: new Date(now.getTime() - v * 24 * 3600 * 1000),
				durationMinutes: 65,
				visitType: "workout",
			});
		}

		// Nutritionist booking (ACCEPTED)
		await NutritionistBooking.create({
			userId: user._id,
			bookingDate: new Date(now.getTime() + 3 * 24 * 3600 * 1000),
			startTime: "11:00 AM",
			endTime: "11:45 AM",
			appointmentMode: AppointmentMode.ONLINE,
			status: NutritionistBookingStatus.ACCEPTED,
			clinicLocation: "Fitflix Sainikpuri",
		});

		// Habits & Goal
		await MemberGoal.create({
			userId: user._id,
			type: GoalType.Weight,
			title: "Target 65kg",
			startValue: 73.7,
			currentValue: 73.7,
			targetValue: 65.0,
			unit: "kg",
			status: GoalStatus.Active,
		});

		for (const title of ["Drink 3L Water", "Morning Stretch", "Walk 8k Steps"]) {
			await Habit.create({
				userId: user._id,
				title,
				category: HabitCategory.Health,
				icon: "check_circle",
				isPinnedToHome: true,
				targetDaysPerWeek: 7,
				currentStreak: 5,
				isActive: true,
			});
		}

		// 7 Sleep logs
		for (let s = 1; s <= 7; s++) {
			const d = new Date(now.getTime() - s * 24 * 3600 * 1000);
			const dateStr = d.toISOString().split("T")[0]!;
			await SleepLog.create({
				userId: user._id,
				date: dateStr,
				bedtime: new Date(d.getTime() - 8 * 3600 * 1000),
				wakeTime: d,
				durationMinutes: 480,
				source: SleepSource.Manual,
			});
		}

		// Progress photos (2 photos)
		await ProgressPhoto.create({
			userId: user._id,
			recordedDate: new Date(now.getTime() - 14 * 24 * 3600 * 1000),
			pose: PhotoPose.Front,
			s3Key: "qa-seed/maya-front-1.jpg",
			thumbnailKey: "qa-seed/maya-front-1-thumb.jpg",
			weightKg: 74.5,
		});
		await ProgressPhoto.create({
			userId: user._id,
			recordedDate: now,
			pose: PhotoPose.Front,
			s3Key: "qa-seed/maya-front-2.jpg",
			thumbnailKey: "qa-seed/maya-front-2-thumb.jpg",
			weightKg: 73.7,
		});

		// Medical report PDF
		await MedicalReport.create({
			userId: user._id,
			reportName: "Comprehensive Blood Profile QA",
			reportType: "Blood Test",
			reportUrl: "https://fitflix.in/sample-reports/qa-blood-test.pdf",
			s3Key: "qa-seed/reports/maya-blood.pdf",
			status: "completed",
			testDate: new Date(now.getTime() - 20 * 24 * 3600 * 1000),
		});

		// 3 Community posts
		for (let p = 1; p <= 3; p++) {
			await Post.create({
				authorId: user._id,
				title: `QA Milestone Day ${p * 5}`,
				content: `Consistency is key. Logging set ${p} with Coach Vikram!`,
				authorRole: CommunityRole.Insider,
				visibility: PostVisibility.Public,
				status: PostStatus.Published,
			});
		}

		personaTable.push({
			ID: label,
			Phone: phone,
			Name: user.username,
			Status: "Active Member",
			Sentinels: "Credits: 47 | Plan: QA Gold 47 | Weight: 73.7kg | PT: 7/14",
		});
	}

	await createActiveMember("+919999900003", "P3");
	await createActiveMember("+918919726698", "P3 (Firebase Test Phone)");

	// --- P4: Expired Member (+919999900004) ---
	const userP4 = await User.create({
		username: "QA Expired Amar",
		phone: "+919999900004",
		phoneVerified: true,
		onboarded: true,
		homeLocationId: locationId,
		membershipStatus: "EXPIRED",
		onboardingStatus: {
			onboardingCompleted: true,
			appOnboardingCompleted: true,
		},
	});
	await Membership.create({
		user: userP4._id,
		planName: "QA Silver Expired",
		planId: silverPlan!._id,
		creditsIncluded: 20,
		creditsRemaining: 0, // Sentinel 0
		status: MembershipStatus.Expired,
		price: 8000,
		startDate: new Date(now.getTime() - 35 * 24 * 3600 * 1000),
		endDate: new Date(now.getTime() - 24 * 3600 * 1000), // Ended yesterday
		locationId,
	});
	personaTable.push({
		ID: "P4",
		Phone: "+919999900004",
		Name: userP4.username,
		Status: "Expired Member",
		Sentinels: "Credits: 0 | Plan: QA Silver Expired | Ended Yesterday",
	});

	// --- P4b: Active, Zero Credits (+919999900008) ---
	const userP4b = await User.create({
		username: "QA ZeroCredit Dev",
		phone: "+919999900008",
		phoneVerified: true,
		onboarded: true,
		homeLocationId: locationId,
		membershipStatus: "ACTIVE",
		onboardingStatus: {
			onboardingCompleted: true,
			appOnboardingCompleted: true,
		},
	});
	await Membership.create({
		user: userP4b._id,
		planName: "QA Active Zero",
		creditsIncluded: 20,
		creditsRemaining: 0, // Sentinel 0
		status: MembershipStatus.Active,
		price: 8000,
		startDate: now,
		endDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
		locationId,
	});
	personaTable.push({
		ID: "P4b",
		Phone: "+919999900008",
		Name: userP4b.username,
		Status: "Active, Zero Credits",
		Sentinels: "Credits: 0 | Plan: QA Active Zero | Status: Active",
	});

	// --- P5: Member, Onboarding Not Started (+919999900005) ---
	const userP5 = await User.create({
		username: "QA Onboarding Newbie",
		phone: "+919999900005",
		phoneVerified: true,
		onboarded: false,
		homeLocationId: locationId,
		onboardingStatus: {
			currentStep: OnboardingStep.HEALTH_MARKERS,
			completedSteps: [],
			onboardingCompleted: false,
			appOnboardingCompleted: false,
		},
	});
	await Membership.create({
		user: userP5._id,
		planName: "QA Onb 5",
		creditsIncluded: 10,
		creditsRemaining: 10,
		status: MembershipStatus.Active,
		price: 5000,
		startDate: now,
		endDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
		locationId,
	});
	personaTable.push({
		ID: "P5",
		Phone: "+919999900005",
		Name: userP5.username,
		Status: "Onboarding Incomplete (Step 1)",
		Sentinels: "Plan: QA Onb 5 | currentStep: HEALTH_MARKERS",
	});

	// --- P5b: Member, App Setup Done, Centre Pending (+919999900006) ---
	const userP5b = await User.create({
		username: "QA Onboarding Mid",
		phone: "+919999900006",
		phoneVerified: true,
		onboarded: false,
		homeLocationId: locationId,
		onboardingStatus: {
			currentStep: OnboardingStep.COMPLETED,
			completedSteps: [
				OnboardingStep.HEALTH_MARKERS,
				OnboardingStep.HEALTH_GOALS,
				OnboardingStep.CONSENT,
				OnboardingStep.REPORT_UPLOAD,
			],
			healthMarkersCompleted: true,
			healthGoalsCompleted: true,
			consentCompleted: true,
			reportsUploaded: true,
			appOnboardingCompleted: true, // Key flag
			onboardingCompleted: false, // Centre pending
		},
	});
	await Membership.create({
		user: userP5b._id,
		planName: "QA Onb 5b",
		creditsIncluded: 10,
		creditsRemaining: 10,
		status: MembershipStatus.Active,
		price: 5000,
		startDate: now,
		endDate: new Date(now.getTime() + 30 * 24 * 3600 * 1000),
		locationId,
	});
	personaTable.push({
		ID: "P5b",
		Phone: "+919999900006",
		Name: userP5b.username,
		Status: "App Setup Done, Centre Pending",
		Sentinels: "appOnboardingCompleted: true | onboardingCompleted: false",
	});

	// --- P6: Paused Member (+919999900007) ---
	const userP6 = await User.create({
		username: "QA Paused Priya",
		phone: "+919999900007",
		phoneVerified: true,
		onboarded: true,
		homeLocationId: locationId,
		membershipStatus: "PAUSED",
		onboardingStatus: {
			onboardingCompleted: true,
			appOnboardingCompleted: true,
		},
	});
	await Membership.create({
		user: userP6._id,
		planName: "QA Paused Plan",
		creditsIncluded: 30,
		creditsRemaining: 25,
		status: MembershipStatus.Paused,
		price: 10000,
		startDate: new Date(now.getTime() - 20 * 24 * 3600 * 1000),
		endDate: new Date(now.getTime() + 20 * 24 * 3600 * 1000),
		locationId,
	});
	personaTable.push({
		ID: "P6",
		Phone: "+919999900007",
		Name: userP6.username,
		Status: "Paused Member",
		Sentinels: "MembershipStatus: Paused",
	});

	// --- P7: Doctor / Staff account ---
	let doctorUser = await User.findOne({ email: "qa-doctor@fitflix.in" });
	if (!doctorUser) {
		doctorUser = await User.create({
			username: "Dr. QA Sharma",
			email: "qa-doctor@fitflix.in",
			phone: "+919999900009",
			phoneVerified: true,
			passwordHash: await hashPassword("Doctor@1234"),
			staffRole: ExpertType.Doctor,
			isActive: true,
			homeLocationId: locationId,
		});
	}
	personaTable.push({
		ID: "P7",
		Phone: "+919999900009",
		Name: doctorUser.username,
		Status: "Staff / Doctor",
		Sentinels: "email: qa-doctor@fitflix.in | staffRole: doctor",
	});

	console.log("\n=================== SEEDED PERSONAS ===================");
	console.table(personaTable);
	console.log("=======================================================\n");

	await mongoose.disconnect();
	console.log("Seeding complete. Disconnected from database.");
}

seedPersonas().catch((err) => {
	console.error("Seeding failed with error:", err);
	process.exit(1);
});
