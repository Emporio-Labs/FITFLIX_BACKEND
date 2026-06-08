import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";

config();

async function main() {
	try {
		await connectDB();
		console.log("Connected to MongoDB.");

		const db = mongoose.connection.db;

		// Search for any webhook event containing varma's user ID or email
		const events = await db.collection("webhookevents").find({
			$or: [
				{ "payload.payload.attendees.email": "varma1@gmail.com" },
				{ "payload.payload.title": { $regex: /varma/i } }
			]
		}).toArray();

		console.log(`Found ${events.length} webhook events for varma.`);
		for (const event of events) {
			console.log("\n=================================");
			console.log(`Event ID: ${event.eventId}`);
			console.log(`Trigger: ${event.triggerEvent}`);
			console.log(`Payload:`, JSON.stringify(event.payload, null, 2));
		}

	} catch (err: any) {
		console.error("Error:", err.message);
	} finally {
		await mongoose.disconnect();
		console.log("Disconnected.");
	}
}

main();
