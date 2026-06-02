/**
 * FITFLIX — Clinical Review onboarding integration test
 *
 * Exercises the full onboarding flow (REPORTS UPLOAD SKIPPED), creates a
 * nutritionist booking, then validates that Admin → Nutrition → Clinical
 * Review → View User Modal receives all expected fields. Emits a diagnostic
 * report showing exactly which fields are missing or mismatched.
 *
 * Run:
 *   bun run tests/onboarding/clinical-review-flow.test.ts
 *
 * Required env:
 *   MONGODB_URL          (required)
 *   API_BASE             (default: http://localhost:3000)
 *   TEST_USER_EMAIL      (default: clinical-review-test@fitflix.in)
 *   TEST_USER_PASSWORD   (default: TestPass123!)
 *   ADMIN_EMAIL          (required for admin assertions)
 *   ADMIN_PASSWORD       (required for admin assertions)
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import ConsentForm from "../../src/models/ConsentForm";
import type { Gender } from "../../src/models/Enums";
import ExpertAppointment from "../../src/models/ExpertAppointment";
import HealthGoals from "../../src/models/HealthGoals";
import HealthMarkers from "../../src/models/HealthMarkers";
import NutritionistBooking from "../../src/models/NutritionistBooking";
import User from "../../src/models/User";
import { hashPassword } from "../../src/utils/password";

config();

const API_BASE =
	process.env.API_BASE || `http://localhost:${process.env.PORT || 3000}`;
const TEST_EMAIL =
	process.env.TEST_USER_EMAIL || "clinical-review-test@fitflix.in";
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || "TestPass123!";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

type StepResult = { name: string; pass: boolean; reason?: string };
const results: StepResult[] = [];
const fieldFindings: string[] = [];

const banner = (title: string) => {
	console.log(`\n${"━".repeat(80)}\n  ${title}\n${"━".repeat(80)}`);
};

const recordStep = (name: string, pass: boolean, reason?: string) => {
	results.push({ name, pass, reason });
	console.log(
		`  ${pass ? "PASS" : "FAIL"}: ${name}${reason ? ` — ${reason}` : ""}`,
	);
};

async function callApi(
	label: string,
	method: string,
	path: string,
	body?: unknown,
	token?: string,
): Promise<{ status: number; data: any }> {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	console.log(`\n[API] ${label}`);
	console.log(`  REQUEST URL:  ${method} ${url}`);
	if (body) console.log(`  REQUEST BODY: ${JSON.stringify(body)}`);

	const startedAt = Date.now();
	let res: Response;
	try {
		res = await fetch(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined,
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.log(`  NETWORK ERROR: ${message}`);
		throw err;
	}

	const text = await res.text();
	let data: any = text;
	try {
		data = JSON.parse(text);
	} catch {
		/* leave as text */
	}

	console.log(`  RESPONSE:     ${res.status} (${Date.now() - startedAt}ms)`);
	console.log(
		`  RESPONSE BODY:${typeof data === "string" ? ` ${data.slice(0, 400)}` : `\n${JSON.stringify(data, null, 2).slice(0, 2000)}`}`,
	);

	return { status: res.status, data };
}

const EXPECTED_HEALTH_MARKERS = {
	age: 24,
	gender: "Male",
	height: 175,
	weight: 72,
	targetWeight: 68,
	activityLevel: "Moderate",
	bmi: 23.5, // computed by backend
	// optional array fields
	allergies: ["Peanuts", "Shellfish"],
	medications: ["Vitamin D", "Omega 3"],
	diseaseHistory: ["Asthma"],
	sleepHours: 7,
};

const EXPECTED_GOALS = ["Fat Loss", "Muscle Gain"];

function compareContract(
	section: string,
	expected: Record<string, unknown>,
	actual: Record<string, unknown> | null | undefined,
): void {
	console.log(`\n[CONTRACT] ${section}`);
	if (!actual) {
		console.log(`  ${section} block missing in response.`);
		fieldFindings.push(`${section}: block missing in admin response`);
		return;
	}
	for (const [key, want] of Object.entries(expected)) {
		const got = (actual as Record<string, unknown>)[key];
		const present = got !== undefined && got !== null && got !== "";
		const matches =
			present &&
			(typeof want === "number"
				? Math.abs(Number(got) - want) < 0.5
				: got === want);
		const verdict = matches ? "PASS" : present ? "MISMATCH" : "MISSING";
		console.log(
			`  ${verdict.padEnd(8)} ${key.padEnd(15)} expected=${JSON.stringify(want)} got=${JSON.stringify(got)}`,
		);
		if (!matches) {
			fieldFindings.push(
				`${section}.${key}: ${verdict.toLowerCase()} (expected ${JSON.stringify(want)}, got ${JSON.stringify(got)})`,
			);
		}
	}
}

async function run() {
	const executionStart = Date.now();
	banner("FITFLIX ONBOARDING → CLINICAL REVIEW INTEGRATION TEST");
	console.log(`API_BASE:   ${API_BASE}`);
	console.log(`TEST_EMAIL: ${TEST_EMAIL}`);
	console.log(
		`ADMIN_EMAIL: ${ADMIN_EMAIL ?? "(NOT SET — admin assertions will be skipped)"}`,
	);

	// ── DB connect + reset test user ─────────────────────────────────────────
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) throw new Error("MONGODB_URL is required in .env");
	await mongoose.connect(mongoUrl);
	console.log("\nDB connected.");

	let testUser = await User.findOne({ email: TEST_EMAIL });
	if (!testUser) {
		const passwordHash = await hashPassword(TEST_PASSWORD);
		testUser = await User.create({
			username: "Clinical Review Tester",
			phone: "+15555550199",
			email: TEST_EMAIL,
			age: EXPECTED_HEALTH_MARKERS.age,
			gender: EXPECTED_HEALTH_MARKERS.gender as Gender,
			passwordHash,
			onboarded: false,
		});
		console.log(`Created test user ${testUser._id}`);
	} else {
		// Make sure age/gender match the expected contract
		await User.findByIdAndUpdate(testUser._id, {
			$set: {
				age: EXPECTED_HEALTH_MARKERS.age,
				gender: EXPECTED_HEALTH_MARKERS.gender,
			},
		});
	}
	const userId = testUser._id.toString();
	recordStep(
		"User exists (and age/gender aligned with contract)",
		true,
		userId,
	);

	// Reset onboarding + clear children
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
	await Promise.all([
		HealthMarkers.deleteMany({ userId }),
		HealthGoals.deleteMany({ userId }),
		ConsentForm.deleteMany({ userId }),
		ExpertAppointment.deleteMany({ userId }),
		NutritionistBooking.deleteMany({ user: userId }),
	]);
	recordStep("DB reset (onboarding + booking docs cleared)", true);

	// ── 1. Login ─────────────────────────────────────────────────────────────
	banner("STEP 1 — LOGIN");
	const login = await callApi("LOGIN", "POST", "/auth/login", {
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
	});
	if (login.status !== 200 || !login.data?.accessToken) {
		recordStep("Login", false, `status=${login.status}`);
		throw new Error("Login failed — aborting test.");
	}
	const userToken = login.data.accessToken as string;
	recordStep("Login", true);

	// ── 2. Health Markers ────────────────────────────────────────────────────
	banner("STEP 2 — HEALTH MARKERS");
	const hm = await callApi(
		"POST /onboarding/health-markers",
		"POST",
		"/onboarding/health-markers",
		{
			weight: EXPECTED_HEALTH_MARKERS.weight,
			height: EXPECTED_HEALTH_MARKERS.height,
			allergies: EXPECTED_HEALTH_MARKERS.allergies,
			medications: EXPECTED_HEALTH_MARKERS.medications,
			diseaseHistory: EXPECTED_HEALTH_MARKERS.diseaseHistory,
			sleepHours: EXPECTED_HEALTH_MARKERS.sleepHours,
			activityLevel: EXPECTED_HEALTH_MARKERS.activityLevel,
		},
		userToken,
	);
	const hmOk = hm.status === 201 && hm.data?.healthMarkers?.bmi != null;
	recordStep(
		"Health markers submitted (BMI computed)",
		hmOk,
		hmOk ? `bmi=${hm.data.healthMarkers.bmi}` : `status=${hm.status}`,
	);
	const dbHm = await HealthMarkers.findOne({ userId }).lean();
	recordStep(
		"HealthMarkers persisted to MongoDB",
		!!dbHm,
		dbHm ? `weight=${dbHm.weight}, bmi=${dbHm.bmi}` : "doc missing",
	);
	recordStep(
		"HealthMarkers.allergies[] persisted",
		JSON.stringify(dbHm?.allergies) ===
			JSON.stringify(EXPECTED_HEALTH_MARKERS.allergies),
	);
	recordStep(
		"HealthMarkers.medications[] persisted",
		JSON.stringify(dbHm?.medications) ===
			JSON.stringify(EXPECTED_HEALTH_MARKERS.medications),
	);
	recordStep(
		"HealthMarkers.diseaseHistory[] persisted",
		JSON.stringify(dbHm?.diseaseHistory) ===
			JSON.stringify(EXPECTED_HEALTH_MARKERS.diseaseHistory),
	);
	recordStep(
		"HealthMarkers.sleepHours persisted",
		dbHm?.sleepHours === EXPECTED_HEALTH_MARKERS.sleepHours,
	);

	// ── 3. Health Goals ──────────────────────────────────────────────────────
	banner("STEP 3 — HEALTH GOALS");
	const hg = await callApi(
		"POST /onboarding/health-goals",
		"POST",
		"/onboarding/health-goals",
		{
			goals: EXPECTED_GOALS,
			targetWeight: EXPECTED_HEALTH_MARKERS.targetWeight,
			timeline: "3 months",
			workoutExperience: "Intermediate",
			foodPreferences: ["Vegetarian", "High Protein", "Low Sugar"],
		},
		userToken,
	);
	recordStep("Health goals submitted", hg.status === 201);
	const dbHg = await HealthGoals.findOne({ userId }).lean();
	const goalsStored =
		Array.isArray(dbHg?.goals) &&
		EXPECTED_GOALS.every((g) => dbHg?.goals.includes(g));
	recordStep(
		"HealthGoals.goals[] persisted",
		goalsStored,
		dbHg ? JSON.stringify(dbHg.goals) : "doc missing",
	);
	recordStep(
		"HealthGoals.targetWeight persisted",
		dbHg?.targetWeight === EXPECTED_HEALTH_MARKERS.targetWeight,
		`got=${dbHg?.targetWeight}`,
	);
	recordStep(
		"HealthGoals.foodPreferences[] persisted",
		Array.isArray(dbHg?.foodPreferences) && dbHg?.foodPreferences.length === 3,
	);
	recordStep(
		"HealthGoals.workoutExperience persisted",
		dbHg?.workoutExperience === "Intermediate",
	);
	recordStep("HealthGoals.timeline persisted", dbHg?.timeline === "3 months");

	// ── 4. Consent ───────────────────────────────────────────────────────────
	banner("STEP 4 — CONSENT");
	const cs = await callApi(
		"POST /onboarding/consent",
		"POST",
		"/onboarding/consent",
		{
			consents: [
				{
					type: "WELLNESS_SERVICES",
					accepted: true,
					signatureName: "Clinical Review Tester",
					dateSigned: new Date().toISOString(),
				},
				{
					type: "GYM_FITNESS",
					accepted: true,
					signatureName: "Clinical Review Tester",
					dateSigned: new Date().toISOString(),
				},
			],
		},
		userToken,
	);
	recordStep("Consent submitted", cs.status === 201);

	// ── 5. SKIP Reports Upload (force flag + advance currentStep) ────────────
	banner("STEP 5 — REPORTS UPLOAD (SKIPPED PER REQUIREMENTS)");
	console.log("  Reports upload is intentionally skipped (no S3/multipart).");
	console.log(
		"  Forcing onboardingStatus.reportsUploaded=true and advancing currentStep.",
	);
	await User.findByIdAndUpdate(userId, {
		$set: {
			"onboardingStatus.reportsUploaded": true,
			"onboardingStatus.currentStep": "SPORTS_SCIENTIST_BOOKING",
		},
		$addToSet: { "onboardingStatus.completedSteps": "REPORT_UPLOAD" },
	});
	recordStep("Reports step bypassed (DB flag set)", true);

	// ── 6. Sports scientist (also force-set; we use /onboarding/appointments) ─
	banner("STEP 6 — SPORTS SCIENTIST APPOINTMENT");
	const ss = await callApi(
		"POST /onboarding/appointments (sports_scientist)",
		"POST",
		"/onboarding/appointments",
		{
			expertType: "sports_scientist",
			appointmentDate: new Date(Date.now() + 86400000).toISOString(),
			meetingLink: "https://meet.example.com/ss",
			calComBookingId: "ss-test",
		},
		userToken,
	);
	recordStep("Sports scientist appointment created", ss.status === 201);

	// ── 7. Nutritionist appointment (advances onboarding) ────────────────────
	banner("STEP 7 — NUTRITIONIST APPOINTMENT");
	const nut = await callApi(
		"POST /onboarding/appointments (nutritionist)",
		"POST",
		"/onboarding/appointments",
		{
			expertType: "nutritionist",
			appointmentDate: new Date(Date.now() + 2 * 86400000).toISOString(),
			meetingLink: "https://meet.example.com/nut",
			calComBookingId: "nut-test",
		},
		userToken,
	);
	recordStep("Nutritionist appointment created", nut.status === 201);

	// ── 8. Complete onboarding ───────────────────────────────────────────────
	banner("STEP 8 — COMPLETE ONBOARDING");
	const complete = await callApi(
		"POST /onboarding/complete",
		"POST",
		"/onboarding/complete",
		undefined,
		userToken,
	);
	recordStep("Onboarding complete", complete.status === 200);
	const finalUser = await User.findById(userId).lean();
	recordStep(
		"user.onboarded === true in DB",
		finalUser?.onboarded === true,
		`onboarded=${finalUser?.onboarded}`,
	);

	// ── 9. Admin assertions ──────────────────────────────────────────────────
	banner("STEP 9 — ADMIN APIs (Clinical Review)");
	if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
		console.log(
			"  ADMIN_EMAIL/ADMIN_PASSWORD not set — skipping admin assertions.",
		);
	} else {
		const adminLogin = await callApi("ADMIN LOGIN", "POST", "/auth/login", {
			email: ADMIN_EMAIL,
			password: ADMIN_PASSWORD,
		});
		if (adminLogin.status !== 200 || !adminLogin.data?.accessToken) {
			recordStep("Admin login", false, `status=${adminLogin.status}`);
		} else {
			recordStep("Admin login", true);
			const adminToken = adminLogin.data.accessToken as string;

			// (a) Nutrition roster — should include our user
			const roster = await callApi(
				"GET /nutrition/dashboard/members",
				"GET",
				`/nutrition/dashboard/members?search=${encodeURIComponent(TEST_EMAIL)}`,
				undefined,
				adminToken,
			);
			const rosterUser = roster.data?.items?.find(
				(member: { _id?: string }) => member._id === userId,
			);
			recordStep(
				"User appears in /nutrition/dashboard/members",
				!!rosterUser,
				rosterUser
					? `nutritionStatus=${rosterUser.nutritionStatus}`
					: "not found",
			);
			if (rosterUser) {
				compareContract(
					"roster.healthMarkers",
					{
						weight: EXPECTED_HEALTH_MARKERS.weight,
						height: EXPECTED_HEALTH_MARKERS.height,
						activityLevel: EXPECTED_HEALTH_MARKERS.activityLevel,
						bmi: EXPECTED_HEALTH_MARKERS.bmi,
					},
					rosterUser.healthMarkers,
				);
				compareContract(
					"roster.user",
					{
						age: EXPECTED_HEALTH_MARKERS.age,
						gender: EXPECTED_HEALTH_MARKERS.gender,
					},
					rosterUser,
				);
				const goalsArr = Array.isArray(rosterUser.healthGoals)
					? rosterUser.healthGoals
					: [];
				const goalsMatch = EXPECTED_GOALS.every((g) => goalsArr.includes(g));
				console.log(`\n[CONTRACT] roster.healthGoals`);
				console.log(
					`  ${goalsMatch ? "PASS" : "MISMATCH"} goals expected=${JSON.stringify(EXPECTED_GOALS)} got=${JSON.stringify(goalsArr)}`,
				);
				if (!goalsMatch)
					fieldFindings.push(
						`roster.healthGoals: expected ${JSON.stringify(EXPECTED_GOALS)}, got ${JSON.stringify(goalsArr)}`,
					);
			}

			// (b) View User modal — /nutrition/users/:userId/dashboard
			const view = await callApi(
				"GET /nutrition/users/:userId/dashboard",
				"GET",
				`/nutrition/users/${userId}/dashboard`,
				undefined,
				adminToken,
			);
			recordStep("View User dashboard returns 200", view.status === 200);
			const u = view.data?.user;
			if (u) {
				compareContract(
					"viewUser.user",
					{
						age: EXPECTED_HEALTH_MARKERS.age,
						gender: EXPECTED_HEALTH_MARKERS.gender,
					},
					u,
				);
				compareContract(
					"viewUser.healthMarkers",
					{
						weight: EXPECTED_HEALTH_MARKERS.weight,
						height: EXPECTED_HEALTH_MARKERS.height,
						activityLevel: EXPECTED_HEALTH_MARKERS.activityLevel,
						bmi: EXPECTED_HEALTH_MARKERS.bmi,
						targetWeight: EXPECTED_HEALTH_MARKERS.targetWeight,
					},
					u.healthMarkers,
				);
				// Validate array fields separately (order-insensitive)
				for (const field of [
					"allergies",
					"medications",
					"diseaseHistory",
				] as const) {
					const gotArr: string[] = Array.isArray(u.healthMarkers?.[field])
						? u.healthMarkers[field]
						: [];
					const wantArr = EXPECTED_HEALTH_MARKERS[field];
					const ok = wantArr.every((v) => gotArr.includes(v));
					console.log(
						`  ${ok ? "PASS" : "MISMATCH"} healthMarkers.${field} expected=${JSON.stringify(wantArr)} got=${JSON.stringify(gotArr)}`,
					);
					if (!ok)
						fieldFindings.push(
							`viewUser.healthMarkers.${field}: expected ${JSON.stringify(wantArr)}, got ${JSON.stringify(gotArr)}`,
						);
				}
				const goalsArr2 = Array.isArray(u.healthGoals) ? u.healthGoals : [];
				const goalsOk = EXPECTED_GOALS.every((g) => goalsArr2.includes(g));
				console.log(`\n[CONTRACT] viewUser.healthGoals`);
				console.log(
					`  ${goalsOk ? "PASS" : "MISMATCH"} expected=${JSON.stringify(EXPECTED_GOALS)} got=${JSON.stringify(goalsArr2)}`,
				);
				if (!goalsOk)
					fieldFindings.push(
						`viewUser.healthGoals: expected ${JSON.stringify(EXPECTED_GOALS)}, got ${JSON.stringify(goalsArr2)}`,
					);

				// Onboarding progress + booking details
				if (view.data?.onboardingProgress === undefined) {
					fieldFindings.push(
						"viewUser.onboardingProgress: MISSING (frontend likely shows 'Not Provided')",
					);
					console.log(
						`\n[CONTRACT] viewUser.onboardingProgress\n  MISSING — not returned by dashboard endpoint`,
					);
				}
				if (view.data?.bookingDetails === undefined) {
					fieldFindings.push(
						"viewUser.bookingDetails: MISSING (frontend likely shows 'Not Provided')",
					);
					console.log(
						`\n[CONTRACT] viewUser.bookingDetails\n  MISSING — not returned by dashboard endpoint`,
					);
				}
			}
		}
	}

	// ── 10. Final diagnostic report ──────────────────────────────────────────
	banner("FINAL DIAGNOSTIC REPORT");
	console.log("\n=========================");
	console.log("FITFLIX ONBOARDING REPORT");
	console.log("=========================\n");
	for (const r of results) {
		console.log(
			`${r.pass ? "PASS" : "FAIL"}: ${r.name}${r.reason ? `\n  Reason: ${r.reason}` : ""}`,
		);
	}
	if (fieldFindings.length > 0) {
		console.log(
			`\nFIELD-LEVEL MISMATCHES (root cause of "Not Provided" in modal):`,
		);
		for (const f of fieldFindings) console.log(`  • ${f}`);
	} else {
		console.log(
			"\nNo field-level mismatches detected — modal should render all values.",
		);
	}
	const allPassed = results.every((r) => r.pass) && fieldFindings.length === 0;
	console.log(`\nOVERALL: ${allPassed ? "PASS" : "FAIL"}`);
	console.log(`Elapsed: ${Date.now() - executionStart}ms`);

	await mongoose.disconnect();
	process.exit(allPassed ? 0 : 1);
}

run().catch(async (err) => {
	console.error("\n[CRITICAL] Test halted:", err.stack || err.message || err);
	try {
		await mongoose.disconnect();
	} catch {
		/* ignore */
	}
	process.exit(1);
});
