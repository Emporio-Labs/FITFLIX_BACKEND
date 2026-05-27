import { createServer } from "node:http";
import app from "./src/app";
import connectDB from "./src/utils/db";
import {
	hasGmailWatchCredentials,
	registerGmailWatch,
} from "./src/utils/email.service";
import { initSocketIO } from "./src/services/realtime.service";
import { startReminderPoller } from "./src/services/reminder.service";

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

	const pubsubTopic = process.env.PUBSUB_TOPIC;
	const gmailWatchEnabled = process.env.ENABLE_GMAIL_WATCH === "true";

	if (!gmailWatchEnabled) {
		console.log(
			"Gmail watch registration disabled. Set ENABLE_GMAIL_WATCH=true to enable it.",
		);
	} else if (!pubsubTopic) {
		console.warn(
			"ENABLE_GMAIL_WATCH is true but PUBSUB_TOPIC is not set. Gmail watch registration is skipped.",
		);
	} else if (!hasGmailWatchCredentials()) {
		console.warn(
			"ENABLE_GMAIL_WATCH is true but Gmail OAuth env vars are incomplete. Gmail watch registration is skipped.",
		);
	} else {
		await registerGmailWatch(pubsubTopic);

		setInterval(
			() => {
				void registerGmailWatch(pubsubTopic);
			},
			6 * 24 * 60 * 60 * 1000,
		);
	}

	// Start reminder poller (non-serverless env only; Vercel uses /internal/reminders/tick cron)
	const isServerless = process.env.VERCEL === "1";
	if (!isServerless) {
		startReminderPoller(60_000); // every 60 seconds
	}

	httpServer.listen(port, "0.0.0.0", () => {
		console.log(`Server is running on port ${port}`);
	});
};

await start();
