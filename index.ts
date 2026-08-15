import "./src/utils/patch-v8";
import { createServer } from "node:http";
import app from "./src/app";
import { initSocketIO } from "./src/services/realtime.service";
import { startReminderPoller } from "./src/services/reminder.service";
import { runCallbackEscalationSweep } from "./src/schedulers/callback-escalation.scheduler";
import { runHostNoShowSweep } from "./src/schedulers/host-noshow.scheduler";
import connectDB from "./src/utils/db";

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
const ZEGO_ENV_VARS = ["ZEGO_APP_ID", "ZEGO_SERVER_SECRET", "ZEGO_APP_SIGN"] as const;
const missingZegoVars = ZEGO_ENV_VARS.filter((v) => !process.env[v]?.trim());
if (missingZegoVars.length > 0) {
	console.warn(
		`[STARTUP] WARNING: ZEGOCLOUD features are disabled. Missing environment variables: ${missingZegoVars.join(", ")}`,
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
