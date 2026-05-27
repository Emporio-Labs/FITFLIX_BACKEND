import { config } from "dotenv";
import { existsSync, readFileSync } from "fs";
import crypto from "node:crypto";
import mongoose from "mongoose";
import User from "../src/models/User";
import Lead from "../src/models/Lead";
import Admin from "../src/models/Admin";
import Doctor from "../src/models/Doctor";
import Trainer from "../src/models/Trainer";
import Slot from "../src/models/Slots";
import ConsentForm from "../src/models/ConsentForm";
import HealthGoals from "../src/models/HealthGoals";
import HealthMarkers from "../src/models/HealthMarkers";
import MedicalReport from "../src/models/MedicalReport";
import ExpertAppointment from "../src/models/ExpertAppointment";
import WorkoutSession from "../src/models/WorkoutSession";
import WorkoutExercise from "../src/models/WorkoutExercise";
import SetLog from "../src/models/SetLog";
import WorkoutPlan from "../src/models/WorkoutPlan";
import { hashPassword } from "../src/utils/password";
import { PlanGoal, SplitType, PlanStatus, ExerciseDifficulty, Gender, OnboardingStep } from "../src/models/Enums";

declare global {
	var describe: (name: string, fn: () => void | Promise<void>) => Promise<void>;
	var test: (name: string, fn: () => void | Promise<void>) => Promise<void>;
	var expect: (actual: any) => any;
}

// Load environment variables
config();

// Port configurations
const port = Number(process.env.PORT ?? 3000);
const baseUrl = `http://localhost:${port}`;

// Setup fallback test runner for Node.js (npx tsx) if not executing inside Bun's test runner
if (!(globalThis as any).describe) {
	console.log("ℹ️ [INFO] Bun test environment not detected. Initializing custom TSX test runner.");

	(globalThis as any).describe = async (name: string, fn: () => void | Promise<void>) => {
		console.log(`\n📦 Describe: ${name}`);
		try {
			await fn();
		} catch (err: any) {
			console.error(`🔴 Group Failure in describe "${name}":`, err.message || err);
			process.exitCode = 1;
		}
	};

	(globalThis as any).test = async (name: string, fn: () => void | Promise<void>) => {
		try {
			await fn();
			console.log(`  [PASS] ${name}`);
		} catch (err: any) {
			console.error(`  [FAIL] ${name}`);
			console.error(`         Reason:`, err.message || err);
			process.exitCode = 1;
		}
	};

	(globalThis as any).expect = (actual: any) => {
		const assertionError = (msg: string) => {
			throw new Error(msg);
		};

		return {
			toBe(expected: any) {
				if (actual !== expected) {
					assertionError(`Expected "${actual}" to be "${expected}"`);
				}
			},
			toEqual(expected: any) {
				const actStr = JSON.stringify(actual);
				const expStr = JSON.stringify(expected);
				if (actStr !== expStr) {
					assertionError(`Expected ${actStr} to equal ${expStr}`);
				}
			},
			toBeDefined() {
				if (actual === undefined || actual === null) {
					assertionError("Expected value to be defined, but got undefined/null");
				}
			},
			toBeGreaterThan(expected: number) {
				if (typeof actual !== "number" || actual <= expected) {
					assertionError(`Expected ${actual} to be greater than ${expected}`);
				}
			},
			toContain(expected: any) {
				if (!actual || typeof actual.includes !== "function" || !actual.includes(expected)) {
					assertionError(`Expected ${actual} to contain ${expected}`);
				}
			},
			toHaveProperty(prop: string) {
				if (!actual || typeof actual !== "object" || !(prop in actual)) {
					assertionError(`Expected object to have property "${prop}"`);
				}
			},
		};
	};

	process.on("exit", () => {
		if (process.exitCode === 1) {
			console.log("\n❌ [FAIL] Master test suite completed with regression failures.");
		} else {
			console.log("\n✅ [PASS] Master test suite completed successfully.");
		}
	});
}

// Global execution context for passing tokens, IDs, and endpoints
interface TestContext {
	userId?: string;
	userToken?: string;
	userEmail: string;

	adminToken?: string;
	adminEmail: string;

	nutritionistToken?: string;
	nutritionistEmail: string;

	sportsScientistToken?: string;
	sportsScientistEmail: string;

	leadId?: string;
	sportsSlotId?: string;
	nutritionistSlotId?: string;
	exerciseId?: string;
	planId?: string;
	foodId?: string;

	workoutSessionId?: string;
	workoutExerciseId?: string;
	logSetId?: string;
}

const context: TestContext = {
	userEmail: "user@test.fitflix.com",
	adminEmail: "admin@test.fitflix.com",
	nutritionistEmail: "nutritionist@test.fitflix.com",
	sportsScientistEmail: "scientist@test.fitflix.com",
};

// Route Probing utility for graceful degradation
async function isRouteActive(path: string, method = "GET", headers: Record<string, string> = {}): Promise<boolean> {
	const url = `${baseUrl}${path}`;
	try {
		const res = await fetch(url, {
			method,
			headers: {
				"Content-Type": "application/json",
				...headers,
			},
		});

		// Express unmounted routes return a default 404 (non-JSON standard Express HTML output)
		if (res.status === 404) {
			const contentType = res.headers.get("content-type") || "";
			if (!contentType.includes("json")) {
				return false;
			}
			const body = (await res.json()) as any;
			// If it's our own JSON structure, it's a mounted route returning logical 404
			if (body?.code === "NOT_FOUND" || body?.error) {
				return true;
			}
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

// Sequential waterfall journey
describe("FITFLIX Backend E2E Regression Suite", () => {
	// Database connection and teardown setup
	test("0. DB Reset & Seeding", async () => {
		const dbUrl = process.env.MONGODB_URL;
		expect(dbUrl).toBeDefined();

		await mongoose.connect(dbUrl!);
		console.log("  [INFO] Connected to MongoDB");

		const testEmails = [
			context.userEmail,
			context.adminEmail,
			context.nutritionistEmail,
			context.sportsScientistEmail,
			"lead@test.fitflix.com",
		];

		// Clear pre-existing test documents
		const users = await User.find({ email: { $in: testEmails } });
		const userIds = users.map((u) => u._id);

		await User.deleteMany({ email: { $in: testEmails } });
		await Admin.deleteMany({ email: { $in: testEmails } });
		await Doctor.deleteMany({ email: { $in: testEmails } });
		await Trainer.deleteMany({ email: { $in: testEmails } });
		await Lead.deleteMany({ email: { $in: testEmails } });

		if (userIds.length > 0) {
			await ConsentForm.deleteMany({ userId: { $in: userIds } });
			await HealthGoals.deleteMany({ userId: { $in: userIds } });
			await HealthMarkers.deleteMany({ userId: { $in: userIds } });
			await MedicalReport.deleteMany({ userId: { $in: userIds } });
			await ExpertAppointment.deleteMany({ userId: { $in: userIds } });

			// Clean Nutrition bookings if model exists
			if (mongoose.models.NutritionistBooking) {
				await mongoose.models.NutritionistBooking.deleteMany({ user: { $in: userIds } });
			}

			// Clean Workout Sessions & logs
			const sessions = await WorkoutSession.find({ userId: { $in: userIds } });
			const sessionIds = sessions.map((s) => s._id);
			await WorkoutSession.deleteMany({ userId: { $in: userIds } });

			if (sessionIds.length > 0) {
				const workoutExercises = await WorkoutExercise.find({ sessionId: { $in: sessionIds } });
				const weIds = workoutExercises.map((we) => we._id);
				await WorkoutExercise.deleteMany({ sessionId: { $in: sessionIds } });
				await SetLog.deleteMany({ workoutExerciseId: { $in: weIds } });
			}
		}

		// Delete testing slots created by this script
		await Slot.deleteMany({ startTime: "10:00", endTime: "11:00" });

		// Delete workout plans created by this test
		await WorkoutPlan.deleteMany({ name: "E2E Hypertrophy Plan" });

		console.log("  [INFO] Database purged of test-scoped records.");

		// Seed Admin and Operators
		const hashedPass = await hashPassword("SecureAdmin123!");

		await Admin.create({
			adminName: "E2E Test Admin",
			email: context.adminEmail,
			phone: "+1000000000",
			passwordHash: hashedPass,
		});

		await Doctor.create({
			doctorName: "E2E Sports Scientist",
			email: context.sportsScientistEmail,
			phone: "+1000000001",
			specialities: ["Sports Science"],
			passwordHash: hashedPass,
		});

		await Trainer.create({
			trainerName: "E2E Nutritionist",
			email: context.nutritionistEmail,
			phone: "+1000000002",
			specialities: ["Nutrition"],
			passwordHash: hashedPass,
		});

		console.log("  [INFO] Seeding completed successfully.");
	});

	// Stage 2: Admin Lead Management & User Conversion
	test("1. Admin Lead Management & Conversion", async () => {
		// Log in as Admin
		const loginRes = await fetch(`${baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: context.adminEmail,
				password: "SecureAdmin123!",
			}),
		});
		expect(loginRes.status).toBe(200);
		const loginData = (await loginRes.json()) as any;
		expect(loginData.accessToken).toBeDefined();
		context.adminToken = loginData.accessToken;

		// Create Lead
		const createLeadRes = await fetch(`${baseUrl}/leads`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				leadName: "E2E Test Lead",
				email: "lead@test.fitflix.com",
				phone: "+1999999999",
				source: "manual-admin",
				interestedIn: "Weight Loss",
			}),
		});
		expect(createLeadRes.status).toBe(201);
		const leadData = (await createLeadRes.json()) as any;
		expect(leadData.lead._id).toBeDefined();
		context.leadId = leadData.lead._id;

		// Update Lead status
		const updateLeadRes = await fetch(`${baseUrl}/leads/${context.leadId}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				status: "Qualified",
				notes: "Qualified for E2E trial",
			}),
		});
		expect(updateLeadRes.status).toBe(200);

		// Convert Lead to User
		const convertRes = await fetch(`${baseUrl}/leads/${context.leadId}/convert`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				username: "converteduser",
				phone: "+1999999999",
				age: "28",
				gender: "Male",
				healthGoals: ["Weight Loss"],
				password: "SecurePassword123!",
			}),
		});
		expect(convertRes.status).toBe(201);
		const convertData = (await convertRes.json()) as any;
		expect(convertData.user.id).toBeDefined();
		context.userId = convertData.user.id;

		// Verify Converted User Login
		const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "lead@test.fitflix.com",
				password: "SecurePassword123!",
			}),
		});
		expect(userLoginRes.status).toBe(200);
		const userLoginData = (await userLoginRes.json()) as any;
		expect(userLoginData.accessToken).toBeDefined();
		expect(userLoginData.user.onboarded).toBe(false);
		context.userToken = userLoginData.accessToken;
	});

	// Stage 3: Admin Slot Management
	test("2. Admin Slot Provisioning", async () => {
		// Create Sports Scientist slot
		const sportsSlotRes = await fetch(`${baseUrl}/slots`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				date: "2026-06-01",
				isDaily: false,
				startTime: "10:00",
				endTime: "11:00",
				capacity: 1,
			}),
		});
		expect(sportsSlotRes.status).toBe(201);
		const sportsSlotData = (await sportsSlotRes.json()) as any;
		expect(sportsSlotData.slot._id).toBeDefined();
		context.sportsSlotId = sportsSlotData.slot._id;

		// Create Nutritionist slot
		const nutriSlotRes = await fetch(`${baseUrl}/slots`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				date: "2026-06-02",
				isDaily: false,
				startTime: "10:00",
				endTime: "11:00",
				capacity: 1,
			}),
		});
		expect(nutriSlotRes.status).toBe(201);
		const nutriSlotData = (await nutriSlotRes.json()) as any;
		expect(nutriSlotData.slot._id).toBeDefined();
		context.nutritionistSlotId = nutriSlotData.slot._id;
	});

	// Stage 4: Onboarding Flow (User Context)
	test("3. Onboarding Waterfall", async () => {
		// Assert onboarding step restriction (try uploading consent first — out of order)
		const consentOutOfOrder = await fetch(`${baseUrl}/onboarding/consent`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				consents: [
					{ type: "WELLNESS_SERVICES", accepted: true, signatureName: "Test", dateSigned: "2026-05-26" },
					{ type: "GYM_FITNESS", accepted: true, signatureName: "Test", dateSigned: "2026-05-26" },
				],
			}),
		});
		// Should return 403 step not allowed
		expect(consentOutOfOrder.status).toBe(403);

		// Step 1: Health Markers
		const markersRes = await fetch(`${baseUrl}/onboarding/health-markers`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				weight: 80,
				height: 180,
				allergies: ["nuts"],
				medications: [],
				diseaseHistory: [],
				sleepHours: 8,
				activityLevel: "Moderate",
			}),
		});
		expect(markersRes.status).toBe(201);
		const markersData = (await markersRes.json()) as any;
		expect(markersData.healthMarkers.bmi).toBe(24.7); // 80 / (1.8^2) -> 80 / 3.24 = 24.69

		// Step 2: Health Goals
		const goalsRes = await fetch(`${baseUrl}/onboarding/health-goals`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				goals: ["Muscle Gain"],
				targetWeight: 85,
				timeline: "3 months",
				workoutExperience: "Intermediate",
				foodPreferences: ["High Protein"],
			}),
		});
		expect(goalsRes.status).toBe(201);

		// Step 3: Consent (Dual Consent)
		const consentRes = await fetch(`${baseUrl}/onboarding/consent`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				consents: [
					{ type: "WELLNESS_SERVICES", accepted: true, signatureName: "Test User", dateSigned: "2026-05-26" },
					{ type: "GYM_FITNESS", accepted: true, signatureName: "Test User", dateSigned: "2026-05-26" },
				],
			}),
		});
		expect(consentRes.status).toBe(201);

		// Step 4: Report Upload (Secure Pipeline Metadata ingestion)
		const reportRes = await fetch(`${baseUrl}/onboarding/reports`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				reportName: "E2E Medical Report",
				reportType: "Biochemistry",
				reportUrl: "s3://fitflix-secure-bucket/onboarding/test_blood.pdf",
			}),
		});
		expect(reportRes.status).toBe(201);
		const reportData = (await reportRes.json()) as any;
		expect(reportData.report.reportUrl).toContain("s3://"); // Verify S3 URL stored successfully without leaks

		// Step 5: Sports Scientist Booking
		const sportsRes = await fetch(`${baseUrl}/onboarding/sports-scientist`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				appointmentDate: "2026-06-01T10:00:00.000Z",
				meetingLink: "https://zoom.us/test-meeting-scientist",
				calComBookingId: "cal_sports_123",
			}),
		});
		expect(sportsRes.status).toBe(201);

		// Step 6: Nutritionist Booking
		// Check if nutritionist onboarding step is active on this branch.
		// If unmerged, the endpoint might advance differently. Let's probe.
		const isNutriActive = existsSync("src/routes/onboarding.routes.ts") &&
			readFileSync("src/routes/onboarding.routes.ts", "utf8").includes("/nutritionist");

		if (isNutriActive) {
			const nutriRes = await fetch(`${baseUrl}/onboarding/nutritionist`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${context.userToken}`,
				},
				body: JSON.stringify({
					appointmentDate: "2026-06-02T10:00:00.000Z",
					meetingLink: "https://zoom.us/test-meeting-nutri",
					calComBookingId: "cal_nutri_123",
				}),
			});
			expect(nutriRes.status).toBe(201);
		} else {
			console.log("  [SKIP] Step 6: Onboarding Nutritionist booking not active on current branch");
		}

		// Step 7: Onboarding Completion
		const completeRes = await fetch(`${baseUrl}/onboarding/complete`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
		});
		expect(completeRes.status).toBe(200);

		// Re-fetch login user to assert onboarded: true
		const userLoginRes = await fetch(`${baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "lead@test.fitflix.com",
				password: "SecurePassword123!",
			}),
		});
		expect(userLoginRes.status).toBe(200);
		const userLoginData = (await userLoginRes.json()) as any;
		expect(userLoginData.user.onboarded).toBe(true);
	});

	// Stage 5: Admin Workout Planning & Assignment
	test("4. Workout Planning & Assignment", async () => {
		// Create Exercise (Admin)
		const exerciseRes = await fetch(`${baseUrl}/exercises`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				name: "E2E Squad Benchpress",
				muscleGroup: "Chest",
				difficulty: "Intermediate",
				equipment: "Barbell",
				instructions: "Perform squad barbell press",
				caloriesPerSet: 10,
			}),
		});
		expect(exerciseRes.status).toBe(201);
		const exerciseData = (await exerciseRes.json()) as any;
		expect(exerciseData._id).toBeDefined();
		context.exerciseId = exerciseData._id;

		// Create Workout Plan (Admin)
		const planRes = await fetch(`${baseUrl}/workout-plans`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				name: "E2E Hypertrophy Plan",
				description: "Targeted Chest hypertrophy plan",
				difficulty: "Intermediate",
				duration: 4,
				goal: "Hypertrophy",
				splitType: "UpperLower",
				status: "Active",
				isTemplate: true,
				days: [
					{
						dayNumber: 1,
						name: "Chest Day",
						exercises: [
							{
								exerciseId: context.exerciseId,
								orderIndex: 0,
								targetSets: 3,
								targetReps: 10,
								targetWeightKg: 60,
								restSeconds: 90,
							},
						],
					},
				],
			}),
		});
		expect(planRes.status).toBe(201);
		const planData = (await planRes.json()) as any;
		expect(planData._id).toBeDefined();
		context.planId = planData._id;

		// Assign Workout Plan to Converted User
		const assignRes = await fetch(`${baseUrl}/workout-plans/${context.planId}/assign`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				userIds: [context.userId],
			}),
		});
		expect(assignRes.status).toBe(200);
	});

	// Stage 6: User Workout Execution (Workout Logging CRUD)
	test("5. Mobile Workout Execution", async () => {
		// Retrieve today's session (should automatically start a session using the assigned plan)
		// Wait, let's hit create session with the assigned plan
		const createSessionRes = await fetch(`${baseUrl}/workouts`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				planId: context.planId,
			}),
		});
		expect(createSessionRes.status).toBe(201);
		const sessionData = (await createSessionRes.json()) as any;
		expect(sessionData._id).toBeDefined();
		context.workoutSessionId = sessionData._id;

		// Verify the session contains the exercise we added to the plan
		expect(sessionData.exercises).toBeDefined();
		expect(sessionData.exercises.length).toBeGreaterThan(0);
		context.workoutExerciseId = sessionData.exercises[0]._id;

		// Log Set
		const logSetRes = await fetch(
			`${baseUrl}/workouts/${context.workoutSessionId}/exercises/${context.workoutExerciseId}/sets`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${context.userToken}`,
				},
				body: JSON.stringify({
					actualReps: 10,
					actualWeightKg: 60,
					rpe: 8,
					isWarmup: false,
					notes: "Smooth set",
				}),
			},
		);
		expect(logSetRes.status).toBe(201);
		const setLogData = (await logSetRes.json()) as any;
		expect(setLogData._id).toBeDefined();
		context.logSetId = setLogData._id;

		// Fetch Stats and verify mapping
		const statsRes = await fetch(`${baseUrl}/workouts/me/stats`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
		});
		expect(statsRes.status).toBe(200);
	});

	// Stage 7: Nutrition & Meal Tracking (Adaptive Path)
	test("6. Nutrition & Meal Tracking (Adaptive)", async () => {
		const active = existsSync("src/routes/nutrition.routes.ts");

		if (!active) {
			console.log("  [SKIP] Nutrition routes not active on current branch");
			return;
		}

		// Configure profile (Admin/Nutritionist)
		const profileRes = await fetch(`${baseUrl}/nutrition/profiles`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				userId: context.userId,
				goal: "Maintenance",
				targetCaloriesKcal: 2500,
				targetMacros: {
					proteinG: 150,
					carbsG: 250,
					fatG: 80,
				},
			}),
		});
		expect(profileRes.status).toBe(201);

		// Create Food (Nutritionist / Admin)
		const foodRes = await fetch(`${baseUrl}/nutrition/foods`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
			body: JSON.stringify({
				name: "Chicken Breast",
				caloriesKcal: 165,
				proteinG: 31,
				carbsG: 0,
				fatG: 3.6,
			}),
		});
		expect(foodRes.status).toBe(201);
		const foodData = (await foodRes.json()) as any;
		expect(foodData.food._id).toBeDefined();
		context.foodId = foodData.food._id;

		// Log Meal (User)
		const logMealRes = await fetch(`${baseUrl}/nutrition/my/meal-logs`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.userToken}`,
			},
			body: JSON.stringify({
				items: [
					{
						foodId: context.foodId,
						quantityG: 200,
					},
				],
			}),
		});
		expect(logMealRes.status).toBe(201);
	});

	// Stage 8: Cal.com webhook verification (Adaptive Path)
	test("7. Cal.com Webhook Integration (Adaptive)", async () => {
		const active = existsSync("src/routes/calid-webhook.routes.ts") || 
			(existsSync("src/routes/webhook.route.ts") && readFileSync("src/routes/webhook.route.ts", "utf8").includes("/calcom"));

		if (!active) {
			console.log("  [SKIP] Cal.com Webhook route not active on current branch");
			return;
		}

		const url = existsSync("src/routes/calid-webhook.routes.ts")
			? `${baseUrl}/webhooks/cal`
			: `${baseUrl}/webhook/calcom`;

		const payloadBody = JSON.stringify({
			triggerEvent: "BOOKING_RESCHEDULED",
			createdAt: new Date().toISOString(),
			payload: {
				uid: "cal_sports_123",
				id: 12345,
				status: "ACCEPTED",
				title: "Mock Booking Title",
				startTime: "2026-06-01T11:00:00.000Z",
				endTime: "2026-06-01T12:00:00.000Z",
				eventTypeId: 86431,
			},
		});

		const secret = process.env.CALID_WEBHOOK_SECRET;
		const signature = secret
			? crypto.createHmac("sha256", secret).update(payloadBody).digest("hex")
			: "mock_signature_for_testing";

		// Fire mock calcom update payload
		const webhookRes = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Cal-Signature-256": signature,
			},
			body: payloadBody,
		});
		expect(webhookRes.status).toBe(200);
	});

	// Stage 9: Role Isolation & RBAC Boundaries
	test("8. Role Isolation & RBAC Boundaries", async () => {
		// Log in as Nutritionist (Trainer role)
		const nutLoginRes = await fetch(`${baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: context.nutritionistEmail,
				password: "SecureAdmin123!",
			}),
		});
		expect(nutLoginRes.status).toBe(200);
		const nutLoginData = (await nutLoginRes.json()) as any;
		context.nutritionistToken = nutLoginData.accessToken;

		// Log in as Sports Scientist (Doctor role)
		const sciLoginRes = await fetch(`${baseUrl}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: context.sportsScientistEmail,
				password: "SecureAdmin123!",
			}),
		});
		expect(sciLoginRes.status).toBe(200);
		const sciLoginData = (await sciLoginRes.json()) as any;
		context.sportsScientistToken = sciLoginData.accessToken;

		// 1. Verify Nutritionist (Trainer) Isolation Blockages
		// Trainer cannot mutate exercise database directly (only Admin can update system exercises or user can create user-level ones)
		// Trainer cannot read system admin dashboards or perform credit updates
		const trainerCreditRes = await fetch(`${baseUrl}/credits/users/${context.userId}/balance`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.nutritionistToken}`,
			},
		});
		// Hitting admin-only credit stats returns 403 Forbidden
		expect(trainerCreditRes.status).toBe(403);

		// 2. Verify Sports Scientist (Doctor) Isolation Blockages
		// Doctor cannot access nutritionist plans or patient nutrition profiles (once active)
		const hasNutritionProfile = await isRouteActive("/nutrition/profiles", "GET");
		if (hasNutritionProfile) {
			const doctorNutriRes = await fetch(`${baseUrl}/nutrition/profiles/${context.userId}`, {
				method: "GET",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${context.sportsScientistToken}`,
				},
			});
			expect(doctorNutriRes.status).toBe(403);
		}

		// 3. Verify Admin Omnipresence
		// Admin can access everything
		const adminLeadsRes = await fetch(`${baseUrl}/leads`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${context.adminToken}`,
			},
		});
		expect(adminLeadsRes.status).toBe(200);
	});
});
