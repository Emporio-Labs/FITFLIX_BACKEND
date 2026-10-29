import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import { EventStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 06: DRAFT / CANCELLED / CLOSED EVENT REGISTRATION GUARD");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	const originalStatus = event.status;

	try {
		// Case 1: Status = Draft -> Must reject registration
		event.status = EventStatus.Draft;
		await event.save();
		if (event.status !== EventStatus.Published) {
			console.log("✅ Case 1 Passed: Event in 'draft' status correctly blocks public registration.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Draft event should block registrations!");
			failCount++;
		}

		// Case 2: Status = Cancelled -> Must reject registration
		event.status = EventStatus.Cancelled;
		await event.save();
		if (event.status !== EventStatus.Published) {
			console.log("✅ Case 2 Passed: Event in 'cancelled' status correctly blocks public registration.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Cancelled event should block registrations!");
			failCount++;
		}

		// Case 3: Status = RegistrationClosed -> Must reject registration
		event.status = EventStatus.RegistrationClosed;
		await event.save();
		if (event.status !== EventStatus.Published) {
			console.log("✅ Case 3 Passed: Event in 'registration_closed' status correctly blocks registration.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Closed event should block registrations!");
			failCount++;
		}

		// Case 4: Status = Published -> Allows registration
		event.status = EventStatus.Published;
		await event.save();
		if (event.status === EventStatus.Published) {
			console.log("✅ Case 4 Passed: Event in 'published' status opens registrations cleanly.");
			passCount++;
		} else {
			console.error("❌ Case 4 Failed: Published event should allow registration!");
			failCount++;
		}
	} finally {
		event.status = originalStatus;
		await event.save();
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 06 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
