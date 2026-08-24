import "./src/utils/patch-v8";
import { createServer } from "node:http";
import app from "./src/app";
import { runCallbackEscalationSweep } from "./src/schedulers/callback-escalation.scheduler";
import { runHostNoShowSweep } from "./src/schedulers/host-noshow.scheduler";
import { initSocketIO } from "./src/services/realtime.service";
import { startReminderPoller } from "./src/services/reminder.service";
import connectDB from "./src/utils/db";
import {
	IST_OFFSET_MINUTES,
	IST_TIMEZONE,
	verifyTimeZoneSupport,
} from "./src/utils/timezone.util";
import { BUSINESS_TIMEZONE } from "./src/utils/zego-room";

// --- Startup environment validation ---
const REQUIRED_ENV_VARS = ["MONGODB_URL", "JWT_SECRET"] as const;
const missingEnvVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]?.trim());
if (missingEnvVars.length > 0) {
	console.error(
		`[STARTUP] Missing required environment variables: ${missingEnvVars.join(", ")}. Server cannot start.`,
	);
	process.exit(1);
}

// ZEGOCLOUD features are optional but warn if missing
const ZEGO_ENV_VARS = [
	"ZEGO_APP_ID",
	"ZEGO_SERVER_SECRET",
	"ZEGO_APP_SIGN",
] as const;
const missingZegoVars = ZEGO_ENV_VARS.filter((v) => !process.env[v]?.trim());
if (missingZegoVars.length > 0) {
	console.warn(
		`[STARTUP] WARNING: ZEGOCLOUD features are disabled. Missing environment variables: ${missingZegoVars.join(", ")}`,
	);
}

// --- Timezone sanity check ---
// Sessions are stored as a UTC-midnight date plus a wall-clock "HH:mm", so the
// business timezone is what decides when a class actually happens. Two failures
// are silent: a host whose timezone database cannot resolve Asia/Kolkata reports
// every zone as UTC without erroring, and a box configured with a non-IST
// BUSINESS_TIMEZONE does the same thing deliberately. Either way a 17:45 class
// resolves to 23:15 IST, so its host is refused their own room all evening and
// nothing anywhere else in the system notices. This is the only place that looks.
const istSupport = verifyTimeZoneSupport(IST_TIMEZONE);
const businessZoneSupport = verifyTimeZoneSupport(BUSINESS_TIMEZONE);

if (!istSupport.ok || !businessZoneSupport.ok) {
	const driftMinutes =
		(businessZoneSupport.actualOffsetMinutes ?? 0) - IST_OFFSET_MINUTES;

	console.error(
		[
			"",
			"══════════════════════════════════════════════════════════════════",
			"[STARTUP] TIMEZONE CHECK FAILED",
			"",
			istSupport.ok
				? `  BUSINESS_TIMEZONE is "${BUSINESS_TIMEZONE}". ${businessZoneSupport.message}`
				: `  This host cannot read IST. ${istSupport.message} Its timezone` +
					" database is missing or broken, so every zone resolves as UTC.",
			"",
			`  Session times will land ${Math.abs(driftMinutes)} minutes ${
				driftMinutes < 0 ? "later" : "earlier"
			} than scheduled.`,
			"  Class join windows, booking cutoffs and reminders will all be wrong.",
			"",
			"  Fix: set BUSINESS_TIMEZONE=Asia/Kolkata (or repair this host's",
			"  timezone data) and restart. Starting anyway.",
			"══════════════════════════════════════════════════════════════════",
			"",
		].join("\n"),
	);
}

const port = Number(process.env.PORT ?? 3000);

const start = async () => {
	try {
		await connectDB();
	} catch (error) {
		console.error("Failed to initialize database connection:", error);
		process.exit(1);
	}

	// Create HTTP server so Socket.io can share it
	const httpServer = createServer(app);
	initSocketIO(httpServer);

	// Start background pollers & schedulers (non-serverless env only)
	const isServerless = process.env.VERCEL === "1";
	if (!isServerless) {
		startReminderPoller(60_000); // every 60 seconds
		setInterval(runHostNoShowSweep, 5 * 60_000); // every 5 minutes
		setInterval(runCallbackEscalationSweep, 2 * 60_000); // every 2 minutes
	}

	httpServer.listen(port, "0.0.0.0", () => {
		console.log(`Server is running on port ${port}`);
	});
};

await start();
