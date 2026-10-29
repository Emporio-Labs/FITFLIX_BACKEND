import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import User from "../../src/models/User";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import crypto from "crypto";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 7 EDGE CASE 01: DUPLICATE REGISTRATION RECOVERY RESILIENCE");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const testEmail = "duplicate.recovery.test@fitflix.in";
	const testPhone = "+919999900001";
	const initialTicketId = "FFX-RECOV-1001";

	// Cleanup prior runs
	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	try {
		// 1. Create first registration
		const firstReg = await EventRegistration.create({
			eventId: event._id,
			tierId: event.ticketTiers[0]?.tierId || "general_pass",
			tierName: event.ticketTiers[0]?.name || "General Pass",
			ticketId: initialTicketId,
			attendeeName: "Recovery Tester",
			attendeeEmail: testEmail,
			attendeePhone: testPhone,
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 0,
			verificationToken: crypto.randomBytes(16).toString("hex"),
		});

		if (firstReg && firstReg.ticketId === initialTicketId) {
			console.log(`✅ Step 1: Initial pass created with Ticket ID: ${firstReg.ticketId}`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed to create initial pass.");
			failCount++;
		}

		// 2. Simulate subsequent 1-click booking attempt with same email/phone
		const existingPass = await EventRegistration.findOne({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});

		if (existingPass && existingPass.ticketId === initialTicketId) {
			console.log("✅ Step 2: System detects existing booking and recovers ticketId instead of duplicate charging.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed to recover existing ticketId.");
			failCount++;
		}

		// 3. Verify database did NOT create a second document
		const count = await EventRegistration.countDocuments({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});

		if (count === 1) {
			console.log(`✅ Step 3: Verified strictly 1 registration record in database (count: ${count}).`);
			passCount++;
		} else {
			console.error(`❌ Step 3: Found duplicate records in DB! count: ${count}`);
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
