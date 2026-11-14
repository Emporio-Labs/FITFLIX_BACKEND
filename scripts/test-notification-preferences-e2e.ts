/**
 * scripts/test-notification-preferences-e2e.ts
 *
 * Mandatory Automated E2E Test Suite for Milestone 1:
 * - Default preferences initialization on GET /notifications/preferences
 * - Nested preference mutations via PATCH /notifications/preferences
 * - Zod validation rejection for malformed times and invalid delivery modes
 * - Quiet hours detection across midnight boundaries
 * - Delivery decision pipeline (filtering, milestone-only gating, transactional overrides)
 * - Diagnostic test notification dispatch via POST /notifications/test-push
 */
import axios from "axios";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import Notification from "../src/models/Notification";
import NotificationPreferences from "../src/models/NotificationPreferences";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import {
	NotificationDeliveryMode,
	NotificationKind,
	WorkoutNotificationFrequency,
} from "../src/models/Enums";
import {
	isQuietHoursNow,
	resolveNotificationDelivery,
} from "../src/services/notification-filter.service";
import { hashPassword } from "../src/utils/password";

const BASE_URL = process.env.API_URL || "http://localhost:3000";

function assert(condition: boolean, message: string): void {
	if (!condition) {
		console.error(`❌ ASSERTION FAILED: ${message}`);
		throw new Error(message);
	}
	console.log(`  ✅ ${message}`);
}

async function main() {
	console.log("=================================================");
	console.log("🔔 STARTING NOTIFICATION PREFERENCES E2E TEST SUITE (MILESTONE 1)");
	console.log(`Target Backend: ${BASE_URL}`);
	console.log("=================================================\n");

	await connectDB();

	// 1. Ensure test member exists
	let member = await User.findOne({ email: "whiskey@gmail.com" });
	if (!member) {
		console.log("Creating whiskey@gmail.com test member...");
		const passwordHash = await hashPassword("whiskey123");
		member = await User.create({
			username: "Whiskey Member",
			email: "whiskey@gmail.com",
			phone: "9876543210",
			passwordHash,
			onboarded: true,
			isActive: true,
		});
	}

	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		throw new Error("JWT_SECRET must be configured");
	}

	const token = signAuthToken(
		{
			id: String(member._id),
			email: member.email,
			role: "user",
		},
		jwtConfig,
	);

	const api = axios.create({
		baseURL: BASE_URL,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	// Reset any existing preferences for a clean test run
	await NotificationPreferences.deleteOne({ userId: member._id });

	console.log("\n--- TEST 1: GET /notifications/preferences (Default Initialization) ---");
	const getRes = await api.get("/notifications/preferences");
	assert(getRes.status === 200, "GET /notifications/preferences returns HTTP 200");
	const prefs = getRes.data.preferences;
	assert(prefs.userId === String(member._id), "Preferences document belongs to test user");
	assert(prefs.masterPushEnabled === true, "masterPushEnabled defaults to true");
	assert(
		prefs.coachMessages.directMessages === NotificationDeliveryMode.Both,
		"coachMessages.directMessages defaults to 'both'",
	);
	assert(
		prefs.appointments.reminderLeadMinutes === 60,
		"appointments.reminderLeadMinutes defaults to 60 (1 hour)",
	);
	assert(
		prefs.workouts.completionFrequency ===
			WorkoutNotificationFrequency.MilestoneOnly,
		"workouts.completionFrequency defaults to 'milestone_only'",
	);
	assert(prefs.habits.weighInTime === "07:30", "habits.weighInTime defaults to '07:30'");
	assert(prefs.quietHours.startTime === "22:00", "quietHours.startTime defaults to '22:00'");
	assert(prefs.quietHours.endTime === "07:00", "quietHours.endTime defaults to '07:00'");

	console.log("\n--- TEST 2: PATCH /notifications/preferences (Nested Partial Updates) ---");
	const patchRes = await api.patch("/notifications/preferences", {
		coachMessages: { directMessages: "in_app" },
		appointments: { reminderLeadMinutes: 30 },
		quietHours: { startTime: "23:00", endTime: "06:30" },
	});
	assert(patchRes.status === 200, "PATCH /notifications/preferences returns HTTP 200");
	const updated = patchRes.data.preferences;
	assert(
		updated.coachMessages.directMessages === "in_app",
		"Updated coachMessages.directMessages to 'in_app'",
	);
	assert(
		updated.coachMessages.feedbackAndComments === "both",
		"Preserved sibling coachMessages.feedbackAndComments as 'both'",
	);
	assert(
		updated.appointments.reminderLeadMinutes === 30,
		"Updated appointments.reminderLeadMinutes to 30",
	);
	assert(
		updated.quietHours.startTime === "23:00",
		"Updated quietHours.startTime to '23:00'",
	);
	assert(
		updated.quietHours.endTime === "06:30",
		"Updated quietHours.endTime to '06:30'",
	);

	console.log("\n--- TEST 3: Validation Error Handling ---");
	try {
		await api.patch("/notifications/preferences", {
			quietHours: { startTime: "25:99" },
		});
		assert(false, "Should have thrown for invalid time format '25:99'");
	} catch (err: any) {
		assert(
			err.response?.status === 400 &&
				err.response?.data?.code === "VALIDATION_ERROR",
			"Rejected invalid time format with 400 VALIDATION_ERROR",
		);
	}

	try {
		await api.patch("/notifications/preferences", {
			coachMessages: { directMessages: "invalid_mode" },
		});
		assert(false, "Should have thrown for invalid delivery mode");
	} catch (err: any) {
		assert(
			err.response?.status === 400 &&
				err.response?.data?.code === "VALIDATION_ERROR",
			"Rejected invalid delivery mode with 400 VALIDATION_ERROR",
		);
	}

	console.log("\n--- TEST 4: Quiet Hours Time Calculation Logic ---");
	// Night window (22:00 to 07:00)
	assert(
		isQuietHoursNow("22:00", "07:00", 22 * 60 + 30),
		"22:30 is inside quiet hours (22:00 - 07:00)",
	);
	assert(
		isQuietHoursNow("22:00", "07:00", 2 * 60),
		"02:00 is inside quiet hours (22:00 - 07:00)",
	);
	assert(
		!isQuietHoursNow("22:00", "07:00", 8 * 60),
		"08:00 is OUTSIDE quiet hours (22:00 - 07:00)",
	);
	assert(
		!isQuietHoursNow("22:00", "07:00", 21 * 60 + 59),
		"21:59 is OUTSIDE quiet hours (22:00 - 07:00)",
	);

	// Daytime window (14:00 to 16:00)
	assert(
		isQuietHoursNow("14:00", "16:00", 15 * 60),
		"15:00 is inside daytime quiet hours (14:00 - 16:00)",
	);
	assert(
		!isQuietHoursNow("14:00", "16:00", 17 * 60),
		"17:00 is OUTSIDE daytime quiet hours (14:00 - 16:00)",
	);

	console.log("\n--- TEST 5: Push Filtering & Delivery Engine ---");
	// A. Inside quiet hours (simulate 23:30 at night)
	const quietDecision = await resolveNotificationDelivery(
		String(member._id),
		NotificationKind.AppointmentReminder,
		{ nowMinutes: 23 * 60 + 30 },
	);
	assert(
		quietDecision.shouldPush === false &&
			quietDecision.shouldInApp === true &&
			quietDecision.reason === "quiet_hours_active",
		"Quiet hours suppresses Push while preserving In-App",
	);

	// B. Transactional override during quiet hours (e.g. Appointment Cancellation)
	const transactionalDecision = await resolveNotificationDelivery(
		String(member._id),
		NotificationKind.AppointmentCancelled,
		{ nowMinutes: 23 * 60 + 30 },
	);
	assert(
		transactionalDecision.shouldPush === true &&
			transactionalDecision.shouldInApp === true &&
			transactionalDecision.reason === "transactional_override",
		"Transactional cancellation bypasses quiet hours and sends push",
	);

	// C. Category in_app only mode (configured in Test 2 for directMessages)
	const inAppDecision = await resolveNotificationDelivery(
		String(member._id),
		NotificationKind.CoachMessage,
		{ nowMinutes: 12 * 60 },
	);
	assert(
		inAppDecision.shouldPush === false &&
			inAppDecision.shouldInApp === true &&
			inAppDecision.reason === "in_app_only",
		"Coach message in_app_only mode allows In-App and suppresses Push",
	);

	// D. Workout Milestone-only filtering
	const routineWorkout = await resolveNotificationDelivery(
		String(member._id),
		NotificationKind.WorkoutCompleted,
		{ nowMinutes: 12 * 60, isMilestone: false, isPR: false },
	);
	assert(
		routineWorkout.shouldPush === false &&
			routineWorkout.reason === "workout_routine_filtered",
		"Routine workout push is filtered when frequency is milestone_only",
	);

	const milestoneWorkout = await resolveNotificationDelivery(
		String(member._id),
		NotificationKind.WorkoutCompleted,
		{ nowMinutes: 12 * 60, isMilestone: true },
	);
	assert(
		milestoneWorkout.shouldPush === true && milestoneWorkout.reason === "allowed",
		"Milestone workout push is allowed through",
	);

	console.log("\n--- TEST 6: POST /notifications/test-push (Diagnostics) ---");
	const testPushRes = await api.post("/notifications/test-push");
	assert(testPushRes.status === 200, "POST /notifications/test-push returns HTTP 200");

	// Verify notification row was created in database
	const testNotification = await Notification.findOne({
		userId: member._id,
		kind: NotificationKind.SystemTest,
	}).sort({ createdAt: -1 });

	assert(
		testNotification !== null,
		"In-app Notification row of kind 'system_test' persisted in DB",
	);
	assert(
		testNotification?.title === "Fitflix Notification Test",
		"Notification title matches expected system test copy",
	);

	console.log("\n=================================================");
	console.log("🎉 ALL NOTIFICATION PREFERENCES E2E TESTS PASSED (100%)");
	console.log("=================================================\n");

	process.exit(0);
}

main().catch((err) => {
	console.error("Test failed with error:", err);
	process.exit(1);
});
