import mongoose from "mongoose";
import { config } from "dotenv";
import User from "../../src/models/User";
import HealthMarkers from "../../src/models/HealthMarkers";
import HealthGoals from "../../src/models/HealthGoals";
import ConsentForm from "../../src/models/ConsentForm";
import MedicalReport from "../../src/models/MedicalReport";
import ExpertAppointment from "../../src/models/ExpertAppointment";
import { hashPassword } from "../../src/utils/password";

// Load environment variables from .env
config();

const API_BASE = `http://localhost:${process.env.PORT || 3000}`;
const TEST_EMAIL = "man@fitflix.in";
const TEST_PASSWORD = "man123";

let executionStart = Date.now();
let createdAppointmentIds: string[] = [];
let createdReportIds: string[] = [];
let finalPass = false;
let authToken = "";

async function callApi(
	stepName: string,
	method: string,
	path: string,
	body?: any,
	token?: string,
) {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	console.log(`\n---`);
	console.log(`\n## ${stepName}`);
	console.log(`\nRequest:`);
	console.log(`Endpoint: ${path}`);
	console.log(`Method: ${method}`);
	console.log(`Headers: ${JSON.stringify(headers, null, 2)}`);
	if (body) {
		console.log(`Payload: ${JSON.stringify(body, null, 2)}`);
	}

	const startTime = Date.now();
	let response: Response;
	let responseText = "";
	let responseData: any = null;

	try {
		response = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
		responseText = await response.text();
		try {
			responseData = JSON.parse(responseText);
		} catch {
			responseData = responseText;
		}
	} catch (err: any) {
		const duration = Date.now() - startTime;
		console.error(`\n[ERROR] Network / Execution Error during ${stepName}:`);
		console.error(err.stack || err.message || err);
		console.log(`Timing: ${duration}ms`);
		console.log(`\nFAIL`);
		process.exit(1);
	}

	const duration = Date.now() - startTime;
	console.log(`\nResponse:`);
	console.log(`Status: ${response.status}`);
	console.log(`Body: ${JSON.stringify(responseData, null, 2)}`);
	console.log(`Timing: ${duration}ms`);

	if (!response.ok) {
		console.log(`\nFAIL`);
		console.error(`\nError at step [${stepName}]: Request failed with status ${response.status}`);
		console.error(`Error details: ${JSON.stringify(responseData, null, 2)}`);
		process.exit(1);
	}

	return { data: responseData, status: response.status, duration };
}

async function run() {
	console.log("================================================================================");
	console.log("             FITFLIX BACKEND: INTEGRATION TEST (ONBOARDING FLOW)                ");
	console.log("================================================================================");

	try {
		// ──────────────────────────────────────────────────────────────────────────
		// DATABASE RESET & INITIALIZATION (FOR IDEMPOTENCY)
		// ──────────────────────────────────────────────────────────────────────────
		const mongoUrl = process.env.MONGODB_URL;
		if (!mongoUrl) {
			throw new Error("MONGODB_URL is not configured in .env");
		}

		console.log(`Connecting to MongoDB at: ${mongoUrl.replace(/\/\/.*@/, "//***:***@")}`);
		await mongoose.connect(mongoUrl);
		console.log("Database connection successful.");

		// Find or bootstrap the test user
		let testUser = await User.findOne({ email: TEST_EMAIL });
		if (!testUser) {
			console.log(`Test user not found. Creating test user with email ${TEST_EMAIL}...`);
			const passwordHash = await hashPassword(TEST_PASSWORD);
			testUser = await User.create({
				username: "Man User",
				phone: "+15555550123",
				email: TEST_EMAIL,
				age: 29,
				gender: "Male",
				passwordHash,
				onboarded: false,
			});
			console.log(`Test user created successfully.`);
		}
		const userId = testUser._id;
		console.log(`Found test user: ${testUser.username} (${userId})`);

		// Reset onboarding status to step 1
		console.log("Resetting test user's onboarding state in database...");
		await User.findByIdAndUpdate(userId, {
			$set: {
				onboarded: false,
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
				},
			},
		});

		// Clear pre-existing documents to prevent unique key / constraint errors
		console.log("Clearing pre-existing onboarding data documents for test user...");
		await Promise.all([
			HealthMarkers.deleteMany({ userId }),
			HealthGoals.deleteMany({ userId }),
			ConsentForm.deleteMany({ userId }),
			MedicalReport.deleteMany({ userId }),
			ExpertAppointment.deleteMany({ userId }),
		]);
		console.log("Database successfully initialized to a clean state.");

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 1: LOGIN
		// ──────────────────────────────────────────────────────────────────────────
		const loginRes = await callApi("STEP 1: LOGIN", "POST", "/auth/login", {
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
		});

		authToken = loginRes.data.accessToken;
		const userObj = loginRes.data.user;

		console.log(`Returned user object: ${JSON.stringify(userObj, null, 2)}`);
		console.log(`JWT token existence: ${!!authToken}`);
		console.log(`User role: ${userObj?.role}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 2: FETCH CURRENT ONBOARDING STATUS
		// ──────────────────────────────────────────────────────────────────────────
		const statusRes1 = await callApi("STEP 2: FETCH CURRENT ONBOARDING STATUS", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Current Onboarding State: ${JSON.stringify(statusRes1.data, null, 2)}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 3: SUBMIT HEALTH MARKERS
		// ──────────────────────────────────────────────────────────────────────────
		const markersPayload = {
			weight: 70,
			height: 175,
			allergies: ["dust"],
			medications: ["none"],
			diseaseHistory: ["none"],
			sleepHours: 8,
			activityLevel: "Moderate",
		};
		const markersRes = await callApi("STEP 3: SUBMIT HEALTH MARKERS", "POST", "/onboarding/health-markers", markersPayload, authToken);
		const calculatedBmi = markersRes.data.healthMarkers?.bmi;
		console.log(`Calculated BMI: ${calculatedBmi}`);

		// Fetch step transition
		const statusRes2 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes2.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 4: SUBMIT HEALTH GOALS
		// ──────────────────────────────────────────────────────────────────────────
		const goalsPayload = {
			goals: ["Build muscle"],
			targetWeight: 75,
			timeline: "3 months",
			workoutExperience: "Intermediate",
			foodPreferences: ["Veg"],
		};
		const goalsRes = await callApi("STEP 4: SUBMIT HEALTH GOALS", "POST", "/onboarding/health-goals", goalsPayload, authToken);
		console.log(`Stored Goals: ${JSON.stringify(goalsRes.data.healthGoals?.goals, null, 2)}`);

		// Fetch step transition
		const statusRes3 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes3.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 5: SUBMIT CONSENT
		// ──────────────────────────────────────────────────────────────────────────
		const consentPayload = {
			consents: [
				{
					type: "WELLNESS_SERVICES",
					accepted: true,
					signatureName: "Man User",
					dateSigned: new Date().toISOString(),
				},
				{
					type: "GYM_FITNESS",
					accepted: true,
					signatureName: "Man User",
					dateSigned: new Date().toISOString(),
				},
			],
		};
		await callApi("STEP 5: SUBMIT CONSENT", "POST", "/onboarding/consent", consentPayload, authToken);

		// Fetch step transition
		const statusRes4 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes4.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 6: UPLOAD TEST REPORT
		// ──────────────────────────────────────────────────────────────────────────
		const reportPayload = {
			reportName: "Initial Blood Work",
			reportType: "Lab Report",
			reportUrl: "http://example.com/initial-blood-work.pdf",
		};
		const reportRes = await callApi("STEP 6: UPLOAD TEST REPORT", "POST", "/onboarding/reports", reportPayload, authToken);
		const reportId = reportRes.data.report?._id;
		if (reportId) {
			createdReportIds.push(reportId);
		}
		console.log(`Uploaded Report ID: ${reportId}`);

		// Fetch step transition
		const statusRes5 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes5.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 7: BOOK SPORTS SCIENTIST APPOINTMENT
		// ──────────────────────────────────────────────────────────────────────────
		const sportsScientistPayload = {
			expertType: "sports_scientist",
			appointmentDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
			meetingLink: "http://meet.google.com/abc-defg-hij",
			calComBookingId: "ss-booking-123",
		};
		const sportsScientistRes = await callApi("STEP 7: BOOK SPORTS SCIENTIST APPOINTMENT", "POST", "/onboarding/appointments", sportsScientistPayload, authToken);
		const ssAppointmentId = sportsScientistRes.data.appointment?._id;
		if (ssAppointmentId) {
			createdAppointmentIds.push(ssAppointmentId);
		}
		console.log(`Sports Scientist Appointment ID: ${ssAppointmentId}`);

		// Fetch step transition
		const statusRes6 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes6.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 8: BOOK NUTRITIONIST APPOINTMENT
		// ──────────────────────────────────────────────────────────────────────────
		const nutritionistPayload = {
			expertType: "nutritionist",
			appointmentDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // Day after tomorrow
			meetingLink: "http://meet.google.com/xyz-uvwx-yza",
			calComBookingId: "nut-booking-456",
		};
		const nutritionistRes = await callApi("STEP 8: BOOK NUTRITIONIST APPOINTMENT", "POST", "/onboarding/appointments", nutritionistPayload, authToken);
		const nutAppointmentId = nutritionistRes.data.appointment?._id;
		if (nutAppointmentId) {
			createdAppointmentIds.push(nutAppointmentId);
		}
		console.log(`Nutritionist Appointment ID: ${nutAppointmentId}`);

		// Fetch step transition
		const statusRes7 = await callApi("STATE TRANSITION CHECK", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Next onboarding step: ${statusRes7.data.currentStep}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 9: COMPLETE ONBOARDING
		// ──────────────────────────────────────────────────────────────────────────
		const completeRes = await callApi("STEP 9: COMPLETE ONBOARDING", "POST", "/onboarding/complete", undefined, authToken);
		console.log(`Completed At Timestamp: ${completeRes.data.completedAt}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 10: VALIDATE FINAL STATE
		// ──────────────────────────────────────────────────────────────────────────
		const finalStatusRes = await callApi("STEP 10: VALIDATE FINAL STATE", "GET", "/onboarding/status", undefined, authToken);
		console.log(`Final Onboarding State: ${JSON.stringify(finalStatusRes.data, null, 2)}`);

		// ──────────────────────────────────────────────────────────────────────────
		// STEP 11: BOOKING & DATABASE VERIFICATION
		// ──────────────────────────────────────────────────────────────────────────
		console.log("\n---");
		console.log("\n## STEP 11: DATABASE RECORD VERIFICATION");

		// Fetch updated user from DB directly
		const updatedUser = await User.findById(userId);
		if (!updatedUser) {
			throw new Error("Unable to retrieve user document from database for verification");
		}

		console.log(`\nVerifying user database flags...`);
		console.log(`- user.onboarded flag: ${updatedUser.onboarded} (Expected: true)`);
		console.log(`- onboardingCompleted: ${updatedUser.onboardingStatus?.onboardingCompleted} (Expected: true)`);
		console.log(`- healthMarkersCompleted: ${updatedUser.onboardingStatus?.healthMarkersCompleted} (Expected: true)`);
		console.log(`- healthGoalsCompleted: ${updatedUser.onboardingStatus?.healthGoalsCompleted} (Expected: true)`);
		console.log(`- consentCompleted: ${updatedUser.onboardingStatus?.consentCompleted} (Expected: true)`);
		console.log(`- reportsUploaded: ${updatedUser.onboardingStatus?.reportsUploaded} (Expected: true)`);
		console.log(`- sportsScientistBooked: ${updatedUser.onboardingStatus?.sportsScientistBooked} (Expected: true)`);
		console.log(`- nutritionistBooked: ${updatedUser.onboardingStatus?.nutritionistBooked} (Expected: true)`);

		// Verify database collections
		const appointments = await ExpertAppointment.find({ userId });
		console.log(`\nVerifying created database records...`);
		console.log(`- Created appointments found in DB: ${appointments.length} (Expected: 2)`);
		for (const app of appointments) {
			console.log(`  * ${app.expertType} appointment booked on ${app.appointmentDate?.toISOString()} (Status: ${app.bookingStatus})`);
		}

		const reports = await MedicalReport.find({ userId });
		console.log(`- Created medical reports found in DB: ${reports.length} (Expected: 1)`);
		for (const rep of reports) {
			console.log(`  * Report: ${rep.reportName} (${rep.reportType}) -> S3Key/Url: ${rep.reportUrl}`);
		}

		// Final validations
		const userOnboardedSuccess = updatedUser.onboarded === true;
		const statusOnboardedSuccess = finalStatusRes.data.onboardingCompleted === true;

		if (
			userOnboardedSuccess &&
			statusOnboardedSuccess &&
			appointments.length === 2 &&
			reports.length === 1
		) {
			finalPass = true;
		}

	} catch (error: any) {
		console.error("\n[CRITICAL ERROR] Execution interrupted:");
		console.error(error.stack || error.message || error);
		console.log(`\nFAIL`);
		process.exit(1);
	} finally {
		// Clean up database connection
		await mongoose.disconnect();
		console.log("\nDatabase connection closed.");

		// ──────────────────────────────────────────────────────────────────────────
		// FINAL SUMMARY
		// ──────────────────────────────────────────────────────────────────────────
		const totalExecutionTime = Date.now() - executionStart;
		console.log("\n================================================================================");
		console.log(`FINAL RESULT: ${finalPass ? "PASS" : "FAIL"}`);
		console.log(`Completed Steps: ${finalPass ? "All steps (HEALTH_MARKERS -> HEALTH_GOALS -> CONSENT -> REPORT_UPLOAD -> NUTRITIONIST_BOOKING -> COMPLETED)" : "Incomplete"}`);
		console.log(`Created Appointment IDs: ${JSON.stringify(createdAppointmentIds)}`);
		console.log(`Created Report IDs: ${JSON.stringify(createdReportIds)}`);
		console.log(`Total Execution Time: ${totalExecutionTime}ms`);
		console.log(`Onboarding Completion Status: ${finalPass ? "COMPLETED" : "FAILED"}`);
		console.log("================================================================================");

		if (!finalPass) {
			process.exit(1);
		} else {
			process.exit(0);
		}
	}
}

run();
