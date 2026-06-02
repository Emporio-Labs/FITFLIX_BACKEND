import crypto from "node:crypto";
import { config } from "dotenv";
import mongoose from "mongoose";
import AppointmentAuditLog from "../src/models/AppointmentAuditLog";
import {
	AppointmentBookingStatus,
	AuditAction,
	Gender,
	NotificationKind,
	OnboardingStep,
	ReminderStatus,
	WebhookSyncStatus,
} from "../src/models/Enums";
import ExpertAppointment from "../src/models/ExpertAppointment";
import Notification from "../src/models/Notification";
import ScheduledReminder from "../src/models/ScheduledReminder";
import User from "../src/models/User";
import WebhookEvent from "../src/models/WebhookEvent";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

// Load environment variables
config();

const API_BASE =
	process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const TEST_EMAIL = "calid-test@fitflix.local";
const TEST_PASSWORD = "CalId!Test1";
const DEFAULT_TIMEZONE = process.env.CALID_DEFAULT_TIMEZONE || "Asia/Kolkata";

type StepResult = {
	name: string;
	status: "PASS" | "FAIL" | "WARN";
	durationMs: number;
	error?: string;
};
const results: StepResult[] = [];

type AvailableSlot = { start: string; end: string };

// ANSI colors
const color = (text: string, code: number) => `\x1b[${code}m${text}\x1b[0m`;

const printBanner = (title: string) => {
	console.log(color(`\n┌${"─".repeat(78)}┐`, 36));
	console.log(color(`│ ${title.padEnd(76)} │`, 36));
	console.log(color(`└${"─".repeat(78)}┘\n`, 36));
};

const recordStep = (
	name: string,
	status: "PASS" | "FAIL" | "WARN",
	durationMs: number,
	error?: string,
) => {
	results.push({ name, status, durationMs, error });
	const symbol =
		status === "PASS"
			? color("✔ PASS", 32)
			: status === "WARN"
				? color("⚠ WARN", 33)
				: color("✘ FAIL", 31);
	console.log(`  ${symbol}  ${name} (${durationMs}ms)`);
	if (error) {
		console.log(color(`     Error: ${error}`, 31));
	}
};

async function apiFetch(
	method: string,
	path: string,
	options: { token?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const response = await fetch(url, {
		method,
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	const text = await response.text();
	let data: any = text;
	try {
		data = JSON.parse(text);
	} catch {
		// Keep as string
	}

	if (!response.ok && response.status !== 409) {
		// Helper to cleanly print text in the boxed diagnostic display
		const printBoxLine = (label: string, value: string, colorCode: number) => {
			let prefixStr = `  │ [${label}] `;
			const indent = "  │   ";
			const rawLines = value.split("\n");
			for (let i = 0; i < rawLines.length; i++) {
				let text = rawLines[i] || "";
				if (i > 0) {
					prefixStr = indent;
				}
				const maxLen = 78 - prefixStr.length;
				if (text.length <= maxLen) {
					console.error(color(`${(prefixStr + text).padEnd(79)}│`, colorCode));
				} else {
					while (text.length > 0) {
						const chunk = text.slice(0, 78 - prefixStr.length);
						console.error(
							color(`${(prefixStr + chunk).padEnd(79)}│`, colorCode),
						);
						text = text.slice(78 - prefixStr.length);
						prefixStr = indent;
					}
				}
			}
		};

		// 1. Construct detailed expectations
		let expectedUrl = "";
		let expectedReqFormat = "";
		let expectedResFormat = "";

		if (path.includes("/auth/login")) {
			expectedUrl = `POST ${API_BASE}/auth/login`;
			expectedReqFormat =
				'Method: POST\nHeaders: {\n  "Content-Type": "application/json"\n}\nBody Structure:\n{\n  "email": "<user_email>",\n  "password": "<user_password>"\n}';
			expectedResFormat =
				'Status: 200 OK\nResponse JSON Envelope:\n{\n  "status": "success",\n  "data": {\n    "accessToken": "<jwt_token_string>",\n    "user": { ... }\n  }\n}';
		} else if (path.includes("/expert-appointments/availability")) {
			expectedUrl = `GET ${API_BASE}/expert-appointments/availability?...`;
			expectedReqFormat =
				'Method: GET\nQuery Parameters:\n  - expertType: "nutritionist" | "sports_scientist"\n  - startDate: "YYYY-MM-DD"\n  - endDate: "YYYY-MM-DD"\n  - timezone: e.g. "Asia/Kolkata"\nHeaders: {\n  "Authorization": "Bearer <token>"\n}';
			expectedResFormat =
				'Status: 200 OK\nResponse JSON Envelope:\n{\n  "status": "success",\n  "data": {\n    "days": [\n      {\n        "date": "YYYY-MM-DD",\n        "slots": [\n          { "start": "ISO_timestamp_string", "end": "ISO_timestamp_string" }\n        ]\n      }\n    ]\n  }\n}';
		} else if (path.includes("/expert-appointments/book")) {
			expectedUrl = `POST ${API_BASE}/expert-appointments/book`;
			expectedReqFormat =
				'Method: POST\nHeaders: {\n  "Content-Type": "application/json",\n  "Authorization": "Bearer <token>"\n}\nBody Structure:\n{\n  "expertType": "nutritionist" | "sports_scientist",\n  "slotStart": "ISO_timestamp_string",\n  "timezone": "Asia/Kolkata"\n}';
			expectedResFormat =
				'Status: 200 OK or 201 Created\nResponse JSON Envelope:\n{\n  "status": "success",\n  "data": {\n    "message": "Appointment booked successfully",\n    "appointment": {\n      "_id": "<ObjectId>",\n      "calIdBookingId": "<calid_booking_uid>",\n      "calIdEventTypeId": "<calid_event_type_id>",\n      "bookingStatus": "CONFIRMED",\n      ... \n    }\n  }\n}';
		} else if (path.includes("/reschedule")) {
			const apptId = path.split("/")[2] || ":appointmentId";
			expectedUrl = `PATCH ${API_BASE}/expert-appointments/${apptId}/reschedule`;
			expectedReqFormat =
				'Method: PATCH\nHeaders: {\n  "Content-Type": "application/json",\n  "Authorization": "Bearer <token>"\n}\nBody Structure:\n{\n  "slotStart": "ISO_timestamp_string",\n  "timezone": "Asia/Kolkata"\n}';
			expectedResFormat =
				'Status: 200 OK\nResponse JSON Envelope:\n{\n  "status": "success",\n  "data": {\n    "message": "Appointment rescheduled successfully",\n    "appointment": {\n      "_id": "<ObjectId>",\n      "appointmentStart": "<new_ISO_start>",\n      "appointmentEnd": "<new_ISO_end>",\n      "calIdBookingId": "<new_calid_booking_uid>",\n      ... \n    }\n  }\n}';
		} else if (path.includes("/cancel")) {
			const apptId = path.split("/")[2] || ":appointmentId";
			expectedUrl = `PATCH ${API_BASE}/expert-appointments/${apptId}/cancel`;
			expectedReqFormat =
				'Method: PATCH\nHeaders: {\n  "Content-Type": "application/json",\n  "Authorization": "Bearer <token>"\n}\nBody Structure:\n{\n  "reason": "<cancellation_reason_string>"\n}';
			expectedResFormat =
				'Status: 200 OK\nResponse JSON Envelope:\n{\n  "status": "success",\n  "data": {\n    "message": "Appointment cancelled successfully"\n  }\n}';
		} else {
			expectedUrl = `${method} ${url}`;
			expectedReqFormat = `Method: ${method}\nHeaders: Content-Type: application/json`;
			expectedResFormat = "Status: 2xx Success";
		}

		// 2. Construct what was actually sent
		let actualReq = `Method: ${method}\nURL: ${url}\nHeaders: {\n  "Content-Type": "application/json"${options.token ? `,\n  "Authorization": "Bearer ${options.token.slice(0, 15)}..."` : ""}\n}`;
		if (options.body) {
			actualReq += `\nBody: ${JSON.stringify(options.body, null, 2)}`;
		}

		// 3. Construct what was actually received
		let actualRes = `Status: HTTP ${response.status}`;
		actualRes += `\nBody: ${typeof data === "object" ? JSON.stringify(data, null, 2) : String(data)}`;

		// 4. Construct high-level explanation / diagnosis
		let explanation = "Unknown internal server exception.";
		if (response.status === 500) {
			explanation =
				"Unhandled exception occurred. Check your backend console logs! (Is the old code cached in memory? Restart 'npm run dev'!)";
		} else if (response.status === 502) {
			const errorMsg = data?.errors?.message || data?.message || "";
			if (errorMsg.includes("no_available_users_found_error")) {
				explanation =
					"Cal ID returned 'no_available_users_found_error'. This means your Cal ID request payload format is 100% correct, but there are no available slots or hosts set up for event 86433 on your Cal ID dashboard calendar at this time!";
			} else if (errorMsg.includes("property 'responses'")) {
				explanation =
					"Cal ID is missing required 'responses' field in the body. (Your backend is running the old cached code, restart 'npm run dev'!)";
			} else if (errorMsg.includes("property 'end'")) {
				explanation =
					"Cal ID is missing required 'end' timestamp in the body. (Your backend is running the old cached code, restart 'npm run dev'!)";
			} else {
				explanation = `Cal ID API returned a downstream error: ${errorMsg}`;
			}
		}

		// 5. Output beautiful boxed report
		console.error(
			color(
				`\n  ┌──────────────────────────────────────────────────────────────────────────────┐`,
				31,
			),
		);
		console.error(
			color(
				`  │ ✘ API CALL FAILED                                                            │`,
				31,
			),
		);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);
		console.error(
			color(`  │ Request : ${method.padEnd(6)} ${path.padEnd(59)} │`, 31),
		);
		console.error(
			color(`  │ Status  : ${response.status.toString().padEnd(68)} │`, 31),
		);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);

		printBoxLine("EXPECTED ENDPOINT URL", expectedUrl, 32);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);
		printBoxLine("EXPECTED REQUEST FORMAT", expectedReqFormat, 32);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);
		printBoxLine("EXPECTED RESPONSE FORMAT", expectedResFormat, 32);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);

		printBoxLine("ACTUAL REQUEST SENT", actualReq, 31);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);
		printBoxLine("ACTUAL RESPONSE RECEIVED", actualRes, 31);
		console.error(
			color(
				`  ├──────────────────────────────────────────────────────────────────────────────┤`,
				31,
			),
		);

		printBoxLine("DIAGNOSIS & RECOMMENDATION", explanation, 33);
		console.error(
			color(
				`  └──────────────────────────────────────────────────────────────────────────────┘\n`,
				31,
			),
		);

		throw new Error(
			`HTTP ${response.status}: ${typeof data === "object" ? JSON.stringify(data) : data}`,
		);
	}

	return { status: response.status, data };
}

async function run() {
	const suiteStart = Date.now();
	printBanner("FITFLIX CAL ID NUTRITIONIST SCHEDULING INTEGRATION TEST");

	let userId = "";
	let token = "";
	let appointmentId = "";
	let calIdBookingId = "";
	let firstAvailableSlot: AvailableSlot | null = null;
	let secondAvailableSlot: AvailableSlot | null = null;

	try {
		await connectDB();
		console.log(color("  MongoDB connected successfully.", 32));

		// ─── Preflight Health Checks ───
		const preflightStart = Date.now();
		try {
			const health = await fetch(`${API_BASE}/health`);
			if (!health.ok) throw new Error("Health check returned bad status");
			recordStep(
				"Pre-flight: API Health Check",
				"PASS",
				Date.now() - preflightStart,
			);
		} catch (_err: unknown) {
			recordStep(
				"Pre-flight: API Health Check",
				"FAIL",
				Date.now() - preflightStart,
				`Dev server unreachable at ${API_BASE}. Run 'bun run dev' first.`,
			);
			process.exit(1);
		}

		const reqEnvVars = [
			"CALID_API_KEY",
			"CALID_WEBHOOK_SECRET",
			"CALID_BASE_URL",
			"CALID_EVENT_TYPE_NUTRITIONIST",
		];
		const missingEnv = reqEnvVars.filter((v) => !process.env[v]);
		if (missingEnv.length > 0) {
			console.log(
				color(
					`\n  [WARNING] Missing Cal ID environment variables: ${missingEnv.join(", ")}`,
					33,
				),
			);
			console.log(
				color(
					"  The server must have these defined in its .env to communicate with Cal ID.\n",
					33,
				),
			);
		}

		// ─── Phase 0: Database Bootstrap & Setup ───
		const phase0Start = Date.now();
		let testUser = await User.findOne({ email: TEST_EMAIL });
		if (!testUser) {
			const passwordHash = await hashPassword(TEST_PASSWORD);
			testUser = await User.create({
				username: "Cal ID Test User",
				phone: "+15555551234",
				email: TEST_EMAIL,
				age: 30,
				gender: Gender.Male,
				passwordHash,
				onboarded: false,
			});
		}
		userId = testUser._id.toString();

		testUser.onboarded = false;
		testUser.onboardingStatus = {
			currentStep: OnboardingStep.NUTRITIONIST_BOOKING,
			completedSteps: [
				OnboardingStep.HEALTH_MARKERS,
				OnboardingStep.HEALTH_GOALS,
				OnboardingStep.CONSENT,
				OnboardingStep.REPORT_UPLOAD,
				OnboardingStep.SPORTS_SCIENTIST_BOOKING,
			],
			healthMarkersCompleted: true,
			healthGoalsCompleted: true,
			consentCompleted: true,
			reportsUploaded: true,
			sportsScientistBooked: true,
			nutritionistBooked: false,
			onboardingCompleted: false,
		};
		await testUser.save();

		await Promise.all([
			ExpertAppointment.deleteMany({ userId }),
			AppointmentAuditLog.deleteMany({ userId }),
			ScheduledReminder.deleteMany({ userId }),
			Notification.deleteMany({ userId }),
			WebhookEvent.deleteMany({
				"payload.booking.attendees.email": TEST_EMAIL,
			}),
		]);
		recordStep(
			"PHASE 0: DB Bootstrap & User Setup",
			"PASS",
			Date.now() - phase0Start,
		);

		// ─── Phase 1: User Login ───
		const phase1Start = Date.now();
		const loginRes = await apiFetch("POST", "/auth/login", {
			body: { email: TEST_EMAIL, password: TEST_PASSWORD },
		});
		token = loginRes.data.accessToken;
		recordStep(
			"PHASE 1: Fetch Authentication Token",
			"PASS",
			Date.now() - phase1Start,
		);

		// ─── Phase 2: Query Cal ID Availability ───
		const phase2Start = Date.now();
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const startDate = tomorrow.toISOString().slice(0, 10);

		const future = new Date();
		future.setDate(future.getDate() + 14);
		const endDate = future.toISOString().slice(0, 10);

		const availabilityRes = await apiFetch(
			"GET",
			`/expert-appointments/availability?expertType=nutritionist&startDate=${startDate}&endDate=${endDate}&timezone=${DEFAULT_TIMEZONE}`,
			{ token },
		);

		const days = availabilityRes.data?.days ?? [];
		for (const day of days) {
			if (!Array.isArray(day.slots) || day.slots.length === 0) {
				continue;
			}

			for (const slot of day.slots) {
				const exactSlot = { start: slot.start, end: slot.end };
				if (!firstAvailableSlot) {
					firstAvailableSlot = exactSlot;
				} else if (!secondAvailableSlot) {
					secondAvailableSlot = exactSlot;
					break;
				}
			}

			if (firstAvailableSlot && secondAvailableSlot) break;
		}

		if (!firstAvailableSlot || !secondAvailableSlot) {
			throw new Error(
				"Cal ID availability returned fewer than two exact slots; cannot continue booking flow.",
			);
		}

		recordStep(
			"PHASE 2: Query Nutritionist Availability",
			"PASS",
			Date.now() - phase2Start,
		);

		// ─── Phase 3: Book Appointment ───
		const phase3Start = Date.now();
		const bookRes = await apiFetch("POST", "/expert-appointments/book", {
			token,
			body: {
				expertType: "nutritionist",
				slotStart: firstAvailableSlot.start,
				timezone: DEFAULT_TIMEZONE,
			},
		});

		appointmentId = bookRes.data?.appointment?._id;
		calIdBookingId = bookRes.data?.appointment?.calIdBookingId;

		if (!appointmentId || !calIdBookingId) {
			throw new Error(
				"API did not return valid appointmentId or calIdBookingId.",
			);
		}
		recordStep(
			"PHASE 3: Execute Onboarding Booking",
			"PASS",
			Date.now() - phase3Start,
		);

		// ─── Phase 3.7: Webhook Delivery & Google Meet Sync Verification ───
		const phase37Start = Date.now();
		const webhookSecret = process.env.CALID_WEBHOOK_SECRET || "fitflix_cal";
		const simulatedWebhookBody = {
			triggerEvent: "BOOKING_CONFIRMED" as const,
			uid: `simulated-webhook-delivery-${Date.now()}`,
			createdAt: new Date().toISOString(),
			payload: {
				uid: calIdBookingId,
				id: 102833,
				status: "ACCEPTED",
				title:
					"Nutritionist Consultation between Dandu Yeshwanth and Cal ID Test User",
				startTime: firstAvailableSlot.start,
				endTime: firstAvailableSlot.end,
				eventTypeId: 86433,
				meetingUrl: "https://meet.google.com/qvi-ufui-kca",
				location: "integrations:google:meet",
				attendees: [
					{
						name: "Cal ID Test User",
						email: TEST_EMAIL,
						timeZone: DEFAULT_TIMEZONE,
					},
				],
			},
		};

		const rawBodyStr = JSON.stringify(simulatedWebhookBody);
		const signature = crypto
			.createHmac("sha256", webhookSecret)
			.update(Buffer.from(rawBodyStr))
			.digest("hex");

		const webhookUrl = `${API_BASE}/webhooks/cal`;
		const webhookResponse = await fetch(webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Cal-Signature-256": `sha256=${signature}`,
			},
			body: rawBodyStr,
		});

		if (!webhookResponse.ok) {
			const errorTxt = await webhookResponse.text();
			throw new Error(
				`Simulated webhook post failed (Status ${webhookResponse.status}): ${errorTxt}`,
			);
		}

		// Wait a small moment to ensure the async handler finishes
		await new Promise((resolve) => setTimeout(resolve, 500));

		const syncedApp = await ExpertAppointment.findById(appointmentId);
		if (!syncedApp) {
			throw new Error(
				"Mongoose verification: Created ExpertAppointment not found in DB.",
			);
		}

		if (syncedApp.webhookSyncStatus !== WebhookSyncStatus.Synced) {
			throw new Error(
				`Webhook sync failed: expected webhookSyncStatus to be "SYNCED" (WebhookSyncStatus.Synced), got "${syncedApp.webhookSyncStatus}"`,
			);
		}

		if (syncedApp.meetingUrl !== "https://meet.google.com/qvi-ufui-kca") {
			throw new Error(
				`Google Meet URL update failed: expected "https://meet.google.com/qvi-ufui-kca", got "${syncedApp.meetingUrl}"`,
			);
		}

		recordStep(
			"PHASE 3.7: Webhook Delivery & Google Meet Sync Verification",
			"PASS",
			Date.now() - phase37Start,
		);

		// ─── Phase 4: DB Verification ───
		const phase4Start = Date.now();
		const [dbApp, dbAudit, dbReminders, dbNotifications] = await Promise.all([
			ExpertAppointment.findById(appointmentId),
			AppointmentAuditLog.findOne({
				appointmentId,
				action: AuditAction.Booked,
			}),
			ScheduledReminder.find({ appointmentId }),
			Notification.find({ userId }),
		]);

		if (!dbApp || dbApp.bookingStatus !== AppointmentBookingStatus.Confirmed) {
			throw new Error(
				"DB verification: ExpertAppointment Confirmed record missing or invalid status.",
			);
		}
		if (!dbAudit || dbAudit.action !== AuditAction.Booked) {
			throw new Error(
				"DB verification: AppointmentAuditLog for BOOKED action missing.",
			);
		}
		if (dbReminders.length === 0) {
			throw new Error("DB verification: ScheduledReminders not set.");
		}
		if (
			dbNotifications.length === 0 ||
			!dbNotifications.some(
				(n) => n.kind === NotificationKind.AppointmentBooked,
			)
		) {
			throw new Error("DB verification: Booked event notification missing.");
		}
		recordStep(
			"PHASE 4: Mongoose DB Side-Effects Verification",
			"PASS",
			Date.now() - phase4Start,
		);

		// ─── Phase 5: Duplicate Slot Protection ───
		const phase5Start = Date.now();
		const duplicateRes = await apiFetch("POST", "/expert-appointments/book", {
			token,
			body: {
				expertType: "nutritionist",
				slotStart: firstAvailableSlot.start,
				timezone: DEFAULT_TIMEZONE,
			},
		});

		if (duplicateRes.status !== 409) {
			throw new Error(
				`Expected 409 Conflict for double-booking, received status ${duplicateRes.status}`,
			);
		}
		recordStep(
			"PHASE 5: Verify Duplicate Booking Slot Protection",
			"PASS",
			Date.now() - phase5Start,
		);

		// ─── Phase 6: Reschedule Appointment ───
		const phase6Start = Date.now();
		const rescheduleAvailability = await apiFetch(
			"GET",
			`/expert-appointments/availability?expertType=nutritionist&startDate=${startDate}&endDate=${endDate}&timezone=${DEFAULT_TIMEZONE}`,
			{ token },
		);

		let rescheduleSlot: AvailableSlot | null = null;
		const originalStartMs = new Date(firstAvailableSlot.start).getTime();
		const minRescheduleGapMs = 2 * 60 * 60 * 1000;
		const rescheduleDays = rescheduleAvailability.data?.days ?? [];
		for (const day of rescheduleDays) {
			if (!Array.isArray(day.slots) || day.slots.length === 0) continue;
			for (const slot of day.slots) {
				if (slot.start === firstAvailableSlot.start) continue;
				const slotStartMs = new Date(slot.start).getTime();
				if (!Number.isFinite(slotStartMs)) continue;
				if (slotStartMs - originalStartMs < minRescheduleGapMs) continue;
				rescheduleSlot = { start: slot.start, end: slot.end };
				break;
			}
			if (rescheduleSlot) break;
		}

		if (!rescheduleSlot) {
			for (const day of rescheduleDays) {
				if (!Array.isArray(day.slots) || day.slots.length === 0) continue;
				if (day.date <= firstAvailableSlot.start.slice(0, 10)) continue;
				const slot = day.slots[0];
				if (!slot || slot.start === firstAvailableSlot.start) continue;
				rescheduleSlot = { start: slot.start, end: slot.end };
				break;
			}
		}

		if (!rescheduleSlot) {
			throw new Error(
				"Fresh availability did not return a different reschedule slot.",
			);
		}

		const rescheduleRes = await apiFetch(
			"PATCH",
			`/expert-appointments/${appointmentId}/reschedule`,
			{
				token,
				body: {
					slotStart: rescheduleSlot.start,
					timezone: DEFAULT_TIMEZONE,
				},
			},
		);

		if (rescheduleRes.status !== 200) {
			throw new Error(
				`Reschedule request failed with status ${rescheduleRes.status}`,
			);
		}

		const [reschedApp, activeReminders] = await Promise.all([
			ExpertAppointment.findById(appointmentId),
			ScheduledReminder.find({
				appointmentId,
				status: ReminderStatus.Scheduled,
			}),
		]);

		const expectedStart = new Date(rescheduleSlot.start).getTime();
		const actualStart = reschedApp?.appointmentStart?.getTime();
		if (actualStart !== expectedStart) {
			throw new Error(
				`Expected rescheduled start time to be ${rescheduleSlot.start}, got ${reschedApp?.appointmentStart?.toISOString()}`,
			);
		}
		if (activeReminders.length === 0) {
			throw new Error("Expected rescheduled reminders to be SCHEDULED.");
		}
		for (const r of activeReminders) {
			console.log(
				`     - Rescheduled reminder (${r.kind}) set to fire at: ${r.fireAt.toISOString()}`,
			);
		}
		recordStep(
			"PHASE 6: Reschedule Appointment & Adjust Reminders",
			"PASS",
			Date.now() - phase6Start,
		);

		// ─── Phase 7: Cancel Appointment ───
		const phase7Start = Date.now();
		const cancelRes = await apiFetch(
			"PATCH",
			`/expert-appointments/${appointmentId}/cancel`,
			{
				token,
				body: { reason: "Rescheduled slots test cleanup" },
			},
		);

		if (cancelRes.status !== 200) {
			throw new Error(`Cancel request failed with status ${cancelRes.status}`);
		}

		const [cancelledApp, finalUser, finalReminders] = await Promise.all([
			ExpertAppointment.findById(appointmentId),
			User.findById(userId),
			ScheduledReminder.find({ appointmentId }),
		]);

		if (
			cancelledApp &&
			cancelledApp.bookingStatus !== AppointmentBookingStatus.Cancelled
		) {
			throw new Error(
				`Expected booking status to be Cancelled or deleted, got ${cancelledApp.bookingStatus}`,
			);
		}
		if (finalReminders.some((r) => r.status === ReminderStatus.Scheduled)) {
			throw new Error(
				"All reminders must be cancelled post-appointment cancellation.",
			);
		}
		if (
			finalUser?.onboardingStatus?.currentStep !==
				OnboardingStep.NUTRITIONIST_BOOKING ||
			finalUser?.onboardingStatus?.nutritionistBooked === true
		) {
			throw new Error(
				`Onboarding rewind verification failed. Expected currentStep=NUTRITIONIST_BOOKING and nutritionistBooked=false, got step=${finalUser?.onboardingStatus?.currentStep}, booked=${finalUser?.onboardingStatus?.nutritionistBooked}`,
			);
		}
		recordStep(
			"PHASE 7: Cancel Appointment & Rewind Onboarding Status",
			"PASS",
			Date.now() - phase7Start,
		);

		// ─── Phase 8: Webhook Events ───
		const phase8Start = Date.now();
		let webhookEventFound = false;
		for (let i = 0; i < 5; i++) {
			const events = await WebhookEvent.find({ provider: "calid" });
			if (events.length > 0) {
				webhookEventFound = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		if (webhookEventFound) {
			recordStep(
				"PHASE 8: Webhook Delivery Events Verification",
				"PASS",
				Date.now() - phase8Start,
			);
		} else {
			recordStep(
				"PHASE 8: Webhook Delivery Events Verification",
				"WARN",
				Date.now() - phase8Start,
				"No Cal ID webhook delivery event detected in local logs (expected if Sandbox triggers skipped).",
			);
		}
	} catch (err: any) {
		console.error(
			color("\n  [FATAL ERROR] Suite aborted due to a failure:", 31),
		);
		console.error(err.stack || err.message || err);
		recordStep(
			"Test Suite Completion",
			"FAIL",
			Date.now() - suiteStart,
			err.message,
		);
	} finally {
		if (userId) {
			try {
				await Promise.all([
					ExpertAppointment.deleteMany({ userId }),
					AppointmentAuditLog.deleteMany({ userId }),
					ScheduledReminder.deleteMany({ userId }),
					Notification.deleteMany({ userId }),
					WebhookEvent.deleteMany({
						"payload.booking.attendees.email": TEST_EMAIL,
					}),
					User.deleteOne({ _id: userId }),
				]);
				console.log(
					color("  Database cleaned successfully. Test artifacts removed.", 32),
				);
			} catch (cleanupErr) {
				console.error("  Error during DB cleanup", cleanupErr);
			}
		}
		await mongoose.disconnect();
		console.log(color("  Database connection closed.", 32));

		console.log(
			"\n=================================================================================",
		);
		console.log(
			"                           CAL ID INTEGRATION FLOW SUMMARY                       ",
		);
		console.log(
			"=================================================================================\n",
		);

		let allPassed = true;
		for (const r of results) {
			const label =
				r.status === "PASS"
					? color("✔ PASS", 32)
					: r.status === "WARN"
						? color("⚠ WARN", 33)
						: color("✘ FAIL", 31);
			console.log(`  [${label}]  ${r.name.padEnd(58)} (${r.durationMs}ms)`);
			if (r.status === "FAIL") {
				allPassed = false;
			}
		}

		const suiteDuration = Date.now() - suiteStart;
		console.log(
			"\n=================================================================================",
		);
		console.log(
			`  OVERALL SUITE STATUS: ${allPassed ? color("PASS", 32) : color("FAIL", 31)}`,
		);
		console.log(`  Total Suite Execution Time: ${suiteDuration}ms`);
		console.log(
			"=================================================================================\n",
		);

		process.exit(allPassed ? 0 : 1);
	}
}

run();
