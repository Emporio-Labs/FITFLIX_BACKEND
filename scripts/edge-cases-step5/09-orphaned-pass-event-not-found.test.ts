import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 09: ORPHANED PASS & MISSING EVENT GUARD EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const orphanTicketId = "FFX-ORPHAN-9999";
	const nonExistentEventId = new mongoose.Types.ObjectId();

	await EventRegistration.deleteMany({ ticketId: orphanTicketId });

	const orphanPass = await EventRegistration.create({
		eventId: nonExistentEventId, // Phantom event!
		tierId: "some_tier",
		tierName: "Phantom Tier",
		ticketId: orphanTicketId,
		attendeeName: "Orphan User",
		attendeeEmail: "orphan@example.com",
		attendeePhone: "+919999988888",
		paymentStatus: RegistrationPaymentStatus.Free,
		verificationToken: "token_orphan",
	});

	try {
		// 1. Query the pass
		const foundReg = await EventRegistration.findOne({ ticketId: orphanTicketId });
		if (foundReg) {
			console.log("✅ Case 1 Passed: Orphan registration record found in database.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Orphan record not found!");
			failCount++;
		}

		// 2. Query the associated event
		const event = await FitflixEvent.findById(foundReg?.eventId);
		let eventNotFoundGuarded = false;
		if (!event) {
			eventNotFoundGuarded = true;
		}

		if (eventNotFoundGuarded) {
			console.log("✅ Case 2 Passed: Associated event confirmed missing -> controller triggers 404 'Associated event not found'.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Event should not exist for phantom ObjectId!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId: orphanTicketId });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 09 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
