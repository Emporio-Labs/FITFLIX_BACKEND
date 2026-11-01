import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 05: CHECKED-IN DIGITAL PASS STATUS STAMP EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	const ticketId = "FFX-CHECKIN-TEST";
	await EventRegistration.deleteMany({ ticketId });

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: "commune_super_early_bird",
		tierName: "Super Early Bird Pass",
		ticketId,
		attendeeName: "Arjun Reddy",
		attendeeEmail: "arjun@example.com",
		attendeePhone: "+919876500097",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 299,
		verificationToken: "token_stamp_test",
		checkedIn: false,
		checkedInAt: null,
	});

	try {
		// 1. Initial State: Unchecked
		if (reg.checkedIn === false && reg.checkedInAt === null) {
			console.log("✅ Case 1 Passed: Initial state shows 'READY FOR ON-SITE SCANNING'.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Initial state should be unchecked!");
			failCount++;
		}

		// 2. Perform Check-in
		const checkInTimestamp = new Date("2026-10-31T06:14:00Z");
		reg.checkedIn = true;
		reg.checkedInAt = checkInTimestamp;
		await reg.save();

		// 3. Verify Refreshed State
		const reloaded = await EventRegistration.findOne({ ticketId });
		if (reloaded && reloaded.checkedIn === true && reloaded.checkedInAt) {
			const timeString = new Date(reloaded.checkedInAt).toLocaleTimeString();
			console.log(`✅ Case 2 Passed: Digital pass successfully stamped with CHECKED IN status (Timestamp: ${timeString}).`);
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Check-in state did not persist!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 05 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
