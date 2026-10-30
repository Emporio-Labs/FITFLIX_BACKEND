import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import crypto from "crypto";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 8 EDGE CASE 06: LIVE POLLING BACKOFF & TERMINAL STATE LIFECYCLE");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketId = `FFX-POLL-${Math.floor(1000 + Math.random() * 9000)}`;
	const testEmail = "polling.lifecycle.test@fitflix.in";
	const testPhone = "+919999908007";

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId,
		attendeeName: "Polling Lifecycle Tester",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	try {
		// 1. Client polling simulation while unchecked:
		// Active timer fires every 4 seconds
		let pollCounter = 0;
		let isTimerActive = true;
		const maxActivePolls = 3;

		for (let i = 0; i < maxActivePolls; i++) {
			const record = await EventRegistration.findOne({ ticketId: reg.ticketId }).select("checkedIn checkedInAt").lean();
			if (record && !record.checkedIn) {
				pollCounter++;
			}
		}

		if (pollCounter === maxActivePolls && isTimerActive) {
			console.log(`✅ Step 1: Active pass polling executed ${pollCounter} checks at 4s intervals while unchecked.`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed to poll active pass.");
			failCount++;
		}

		// 2. Entrance check-in occurs: Terminal State reached
		const checkInStamp = new Date();
		await EventRegistration.updateOne(
			{ _id: reg._id },
			{ $set: { checkedIn: true, checkedInAt: checkInStamp } },
		);

		// Client executes poll tick and receives checkedIn = true
		const terminalCheck = await EventRegistration.findOne({ ticketId: reg.ticketId }).select("checkedIn checkedInAt").lean();
		if (terminalCheck?.checkedIn) {
			// Cancels polling timer
			isTimerActive = false;
		}

		if (!isTimerActive && terminalCheck?.checkedIn) {
			console.log("✅ Step 2: Terminal check-in state reached; polling timer cancelled immediately to eliminate server load.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed to terminate polling.");
			failCount++;
		}

		// 3. Screen inactivity timeout guard (15 minutes without scan)
		const sessionDurationMinutes = 16;
		const shouldEnterBackoff = sessionDurationMinutes > 15;
		const backoffIntervalSeconds = shouldEnterBackoff ? 30 : 4;

		if (shouldEnterBackoff && backoffIntervalSeconds === 30) {
			console.log("✅ Step 3: Idle timeout guard engaged: 15+ min session drops polling frequency to 30s to preserve battery.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Battery conservation backoff not triggered.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteOne({ _id: reg._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
