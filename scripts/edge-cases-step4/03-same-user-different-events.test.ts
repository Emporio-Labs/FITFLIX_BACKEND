import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 03: SAME USER ACROSS MULTIPLE DISTINCT EVENTS EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const testEmail = "multi.athlete@example.com";
	const testPhone = "+919123456789";

	const event1 = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	const event2 = await FitflixEvent.findOne({ slug: "fitflix-sunrise-marathon-2026" });

	if (!event1 || !event2) {
		console.error("❌ Both events must exist in DB for cross-event test!");
		process.exit(1);
	}

	await EventRegistration.deleteMany({
		attendeeEmail: testEmail,
		eventId: { $in: [event1._id, event2._id] },
	});

	try {
		// 1. Register for Event 1 (COMMUNE PART 2)
		const reg1 = await EventRegistration.create({
			eventId: event1._id,
			tierId: "commune_early_bird",
			tierName: "Early Bird Pass",
			ticketId: `FFX-COM-${Math.floor(1000 + Math.random() * 9000)}`,
			attendeeName: "Multi Athlete",
			attendeeEmail: testEmail,
			attendeePhone: testPhone,
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 499,
			verificationToken: "token_evt1",
		});

		if (reg1 && reg1.ticketId.startsWith("FFX-COM-")) {
			console.log(`✅ Case 1 Passed: Successfully registered for Event 1 (${event1.title}, Ticket: ${reg1.ticketId}).`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Registration for Event 1 failed!");
			failCount++;
		}

		// 2. Register same attendee for Event 2 (Fitflix Summit 2026)
		const reg2 = await EventRegistration.create({
			eventId: event2._id,
			tierId: "sunrise_all_access_vip",
			tierName: "All Access VIP Pass",
			ticketId: `FFX-DFN-${Math.floor(1000 + Math.random() * 9000)}`,
			attendeeName: "Multi Athlete",
			attendeeEmail: testEmail,
			attendeePhone: testPhone,
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 999,
			verificationToken: "token_evt2",
		});

		if (reg2 && reg2.ticketId.startsWith("FFX-DFN-")) {
			console.log(`✅ Case 2 Passed: Successfully registered same user for Event 2 (${event2.title}, Ticket: ${reg2.ticketId}).`);
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Registration for Event 2 was blocked unexpectedly!");
			failCount++;
		}

		// 3. Verify user's wallet query finds both passes
		const userPasses = await EventRegistration.find({ attendeeEmail: testEmail }).populate("eventId", "title slug");
		if (userPasses.length === 2) {
			console.log(`✅ Case 3 Passed: User wallet successfully aggregates all ${userPasses.length} distinct passes.`);
			passCount++;
		} else {
			console.error(`❌ Case 3 Failed: Expected 2 passes in wallet, found ${userPasses.length}`);
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			attendeeEmail: testEmail,
			eventId: { $in: [event1._id, event2._id] },
		});
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 03 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
