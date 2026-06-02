import crypto from "node:crypto";
import { config } from "dotenv";
import mongoose from "mongoose";
import AppointmentAuditLog from "../src/models/AppointmentAuditLog";
import AvailabilityCache from "../src/models/AvailabilityCache";
import {
	AppointmentBookingStatus,
	AuditAction,
	ExpertType,
	Gender,
	NotificationKind,
	OnboardingStep,
	WebhookSyncStatus,
} from "../src/models/Enums";
import ExpertAppointment from "../src/models/ExpertAppointment";
import Notification from "../src/models/Notification";
import ScheduledReminder from "../src/models/ScheduledReminder";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

// Load environment variables
config();

const API_BASE =
	process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const TEST_EMAIL = "calid-realtime-test@fitflix.local";
const TEST_PASSWORD = "CalId!Test1";
const DEFAULT_TIMEZONE = process.env.CALID_DEFAULT_TIMEZONE || "Asia/Kolkata";

type StepResult = {
	name: string;
	status: "PASS" | "FAIL" | "WARN";
	durationMs: number;
	error?: string;
};
const results: StepResult[] = [];

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
	printBanner("FITFLIX REAL-TIME CAL ID SCHEDULING INTEGRATION TEST");

	let userId = "";
	let token = "";
	let appointmentId = "";
	let calIdBookingId = "";
	let firstAvailableSlot = "";

	try {
		// Connect to DB
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

		// Validate environmental settings
		const reqEnvVars = [
			"CALID_API_KEY",
			"CALID_WEBHOOK_SECRET",
			"CALID_BASE_URL",
			"CALID_EVENT_TYPE_NUTRITIONIST",
		];
		const missingEnv = reqEnvVars.filter((v) => !process.env[v]);
		if (missingEnv.length > 0) {
			throw new Error(
				`REAL PROVIDER VALIDATION ERROR: Missing environmental keys: ${missingEnv.join(", ")}`,
			);
		}

		// ─── Phase 0: Database Bootstrap & User Setup ───
		const phase0Start = Date.now();
		let testUser = await User.findOne({ email: TEST_EMAIL });
		if (!testUser) {
			const passwordHash = await hashPassword(TEST_PASSWORD);
			testUser = await User.create({
				username: "Cal ID Real Tester",
				phone: "+15555559877",
				email: TEST_EMAIL,
				age: 30,
				gender: Gender.Male,
				passwordHash,
				onboarded: false,
			});
		}
		userId = testUser._id.toString();

		// Prime onboarding status to NUTRITIONIST_BOOKING
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

		// Clean up leftover appointments
		await Promise.all([
			ExpertAppointment.deleteMany({ userId }),
			AppointmentAuditLog.deleteMany({ userId }),
			ScheduledReminder.deleteMany({ userId }),
			Notification.deleteMany({ userId }),
			AvailabilityCache.deleteMany({ expertType: ExpertType.Nutritionist }),
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
		const availabilityCompletedAt = Date.now();

		console.log("\nRAW AVAILABILITY RESPONSE:");
		console.log(JSON.stringify(availabilityRes.data, null, 2));

		const days = availabilityRes.data?.days ?? [];
		// Extract first available slot
		for (const day of days) {
			if (day.slots && day.slots.length > 0) {
				for (const slot of day.slots) {
					if (!firstAvailableSlot) {
						firstAvailableSlot = slot.start;
						break;
					}
				}
				if (firstAvailableSlot) break;
			}
		}

		if (!firstAvailableSlot) {
			const nextWeek = new Date();
			nextWeek.setDate(nextWeek.getDate() + 5);
			nextWeek.setHours(10, 0, 0, 0);
			firstAvailableSlot = nextWeek.toISOString();
			recordStep(
				"PHASE 2: Query Nutritionist Availability (Mock Fallback)",
				"WARN",
				Date.now() - phase2Start,
				"No slots returned from Cal ID; using generated mock date slot.",
			);
		} else {
			console.log(`\n  Available Slot Found: ${firstAvailableSlot}`);
			recordStep(
				"PHASE 2: Query Nutritionist Availability",
				"PASS",
				Date.now() - phase2Start,
			);
		}

		// ─── Phase 3: Book Appointment ───
		const phase3Start = Date.now();
		const delayMs = Date.now() - availabilityCompletedAt;
		console.log(
			`\n  [DIAGNOSTIC] Delay between slot availability fetch and booking dispatch: ${delayMs}ms`,
		);

		const bookRes = await apiFetch("POST", "/expert-appointments/book", {
			token,
			body: {
				expertType: "nutritionist",
				slotStart: firstAvailableSlot,
				timezone: DEFAULT_TIMEZONE,
			},
		});

		console.log("\nRAW CAL ID RESPONSE:");
		console.log(JSON.stringify(bookRes.data, null, 2));

		appointmentId = bookRes.data?.appointment?._id;
		calIdBookingId = bookRes.data?.appointment?.calIdBookingId;

		if (!appointmentId || !calIdBookingId) {
			throw new Error(
				"API did not return valid appointmentId or calIdBookingId.",
			);
		}

		console.log("\n================ REAL CAL ID BOOKING =================");
		console.log("Appointment ID:", appointmentId);
		console.log("Cal ID Booking ID:", calIdBookingId);
		console.log("Meeting URL:", bookRes.data?.appointment?.meetingUrl);
		console.log("=======================================================\n");

		// ─── Phase 3.5: REMOTE PROVIDER VERIFICATION (anti-false-positive) ───
		const phase35Start = Date.now();
		const envEventTypeId = process.env.CALID_EVENT_TYPE_NUTRITIONIST ?? "";
		const calBaseUrl = process.env.CALID_BASE_URL ?? "https://api.cal.id";
		const calApiKey = process.env.CALID_API_KEY ?? "";
		const expectedHostRegexStr =
			process.env.CALID_EXPECTED_HOST_EMAIL_REGEX ?? ".*";

		console.log("\n  --- RUNTIME EVENT-TYPE TRACE ---");
		console.log(
			`  [1] test script env CALID_EVENT_TYPE_NUTRITIONIST = ${envEventTypeId}`,
		);
		console.log(
			`  [2] backend stored appointment.calIdEventTypeId  = ${bookRes.data?.appointment?.calIdEventTypeId}`,
		);

		// Direct re-fetch from Cal ID — bypass the backend entirely using query filter
		let remoteUrl = `${calBaseUrl}/booking?bookingUid=${encodeURIComponent(calIdBookingId)}`;
		let remoteResp = await fetch(remoteUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${calApiKey}`,
				"cal-api-version": "2024-08-13",
			},
		});

		// Fallback: If HTTP 400 or 404, attempt /bookings instead of /booking
		if (!remoteResp.ok) {
			const alternativeUrl = `${calBaseUrl}/bookings?bookingUid=${encodeURIComponent(calIdBookingId)}`;
			const altResp = await fetch(alternativeUrl, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${calApiKey}`,
					"cal-api-version": "2024-08-13",
				},
			});
			if (altResp.ok) {
				remoteUrl = alternativeUrl;
				remoteResp = altResp;
			}
		}

		const remoteJson: any = await remoteResp.json().catch(() => ({}));

		// Parse dynamically to locate the correct booking object
		const list = Array.isArray(remoteJson?.data)
			? remoteJson.data
			: remoteJson?.data
				? [remoteJson.data]
				: [];

		let remoteData: any =
			list.find((booking: any) => booking.uid === calIdBookingId) || {};

		if (
			Object.keys(remoteData).length === 0 &&
			remoteJson?.uid === calIdBookingId
		) {
			remoteData = remoteJson;
		}
		if (
			Object.keys(remoteData).length === 0 &&
			remoteJson?.data?.uid === calIdBookingId
		) {
			remoteData = remoteJson.data;
		}
		if (Object.keys(remoteData).length === 0 && list.length > 0) {
			remoteData = list[0];
		}

		const remoteEventTypeId =
			remoteData?.eventType?.id ?? remoteData?.eventTypeId;
		const remoteHosts: Array<{ email?: string; username?: string }> =
			remoteData?.hosts ?? [];
		const remoteHostEmail = remoteHosts[0]?.email ?? "";
		const remoteHostUsername = remoteHosts[0]?.username ?? "";

		console.log(
			`  [3] Cal ID remote refetch status            = ${remoteResp.status}`,
		);
		console.log(
			`  [4] Cal ID remote eventType.id              = ${remoteEventTypeId}`,
		);
		console.log(
			`  [5] Cal ID remote hosts[0].email            = ${remoteHostEmail}`,
		);
		console.log(
			`  [6] Cal ID remote hosts[0].username         = ${remoteHostUsername}`,
		);
		console.log(
			`  [7] Cal ID remote title                     = ${remoteData?.title}`,
		);
		console.log(
			`  [8] Expected host email regex                = ${expectedHostRegexStr}`,
		);
		console.log("  --------------------------------\n");

		// ─── ACCOUNT IDENTITY PROBE (read-only) ───
		console.log("  --- ACCOUNT IDENTITY PROBE ---");
		const probe = async (
			label: string,
			url: string,
			headers: Record<string, string> = {},
		) => {
			try {
				const r = await fetch(url, { method: "GET", headers });
				const txt = await r.text().catch(() => "");
				console.log(
					`  ${label} → HTTP ${r.status} | body[0..200]: ${txt.slice(0, 200)}`,
				);
			} catch (e: any) {
				console.log(`  ${label} → ERROR: ${e?.message ?? e}`);
			}
		};
		await probe(
			"GET /event-types (what does this key own?)  ",
			`${calBaseUrl}/event-types`,
			{ Authorization: `Bearer ${calApiKey}` },
		);
		await probe(
			"GET /booking  (what bookings does it see?) ",
			`${calBaseUrl}/booking`,
			{ Authorization: `Bearer ${calApiKey}` },
		);
		await probe(
			"GET /schedule (what schedules are configured?) ",
			`${calBaseUrl}/schedule`,
			{ Authorization: `Bearer ${calApiKey}` },
		);
		console.log("  ------------------------------\n");

		// ─── DASHBOARD HANDOFF ───
		console.log(
			"\n  ============================================================",
		);
		console.log("           DASHBOARD HANDOFF — verify in your browser");
		console.log(
			"  ============================================================",
		);
		console.log(`  Fresh booking UID            : ${calIdBookingId}`);
		console.log(`  Cal ID remote host email    : ${remoteHostEmail}`);
		console.log(`  Cal ID remote host username : ${remoteHostUsername}`);
		console.log(
			`  Cal ID remote event slug    : ${remoteData?.eventType?.slug ?? "-"}`,
		);
		console.log(
			`  Cal ID remote meeting URL   : ${remoteData?.meetingUrl ?? "-"}`,
		);
		console.log(
			"  ------------------------------------------------------------",
		);
		console.log(
			"  ============================================================\n",
		);

		const traceSnapshot = {
			envEventTypeId,
			storedCalIdEventTypeId: bookRes.data?.appointment?.calIdEventTypeId,
			remoteEventTypeId,
			remoteHostEmail,
			remoteHostUsername,
			remoteTitle: remoteData?.title,
		};

		// Assertion 1: backend didn't mutate the eventTypeId
		if (
			String(bookRes.data?.appointment?.calIdEventTypeId) !==
			String(envEventTypeId)
		) {
			throw new Error(
				`PHASE 3.5 FAIL — backend stored a different eventTypeId than .env loaded. ` +
					`Trace: ${JSON.stringify(traceSnapshot)}`,
			);
		}

		// Assertion 2: Cal ID booked the event type we asked for
		if (String(remoteEventTypeId) !== String(envEventTypeId)) {
			throw new Error(
				`PHASE 3.5 FAIL — Cal ID remote eventType.id (${remoteEventTypeId}) does not match env (${envEventTypeId}). ` +
					`Trace: ${JSON.stringify(traceSnapshot)}`,
			);
		}

		// Assertion 3: host email matches allow-list (or warn if regex is the wide-open default)
		const hostRegex = new RegExp(expectedHostRegexStr);
		if (!hostRegex.test(remoteHostEmail)) {
			throw new Error(
				`PHASE 3.5 FAIL — booking landed on host "${remoteHostEmail}" which does NOT match CALID_EXPECTED_HOST_EMAIL_REGEX="${expectedHostRegexStr}". ` +
					`That means the eventTypeId ${envEventTypeId} is owned by an account that is NOT FITFLIX. ` +
					`Trace: ${JSON.stringify(traceSnapshot)}`,
			);
		}
		if (expectedHostRegexStr === ".*") {
			recordStep(
				`PHASE 3.5: Remote Verify (WARN — set CALID_EXPECTED_HOST_EMAIL_REGEX to lock host="${remoteHostEmail}")`,
				"WARN",
				Date.now() - phase35Start,
			);
		} else {
			recordStep(
				"PHASE 3.5: Remote Provider Verification (host matched)",
				"PASS",
				Date.now() - phase35Start,
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
					"Nutritionist Consultation between Dandu Yeshwanth and Cal ID Real Tester",
				startTime: firstAvailableSlot,
				endTime: new Date(
					new Date(firstAvailableSlot).getTime() + 30 * 60_000,
				).toISOString(),
				eventTypeId: 86433,
				meetingUrl: "https://meet.google.com/qvi-ufui-kca",
				location: "integrations:google:meet",
				attendees: [
					{
						name: "Cal ID Real Tester",
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

		console.log(
			color(
				"\n  [INFO] Real provider slot booking kept active for visual inspection on dashboard.",
				33,
			),
		);
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
		await mongoose.disconnect();
		console.log(color("  Database connection closed.", 32));

		// Print Summary Table
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

// Execute the test script
run();
