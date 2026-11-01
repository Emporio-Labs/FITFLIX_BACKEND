import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 02: DUPLICATE PHONE NUMBER REGISTRATION EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const testPhone = "+919999900001";
	const testEmail1 = "user1@example.com";
	const testEmail2 = "user2.different@example.com";

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	await EventRegistration.deleteMany({ eventId: event._id, attendeePhone: testPhone });

	try {
		// 1. Initial booking with testPhone
		const reg1 = await EventRegistration.create({
			eventId: event._id,
			tierId: "commune_super_early_bird",
			tierName: "Super Early Bird Pass",
			ticketId: `FFX-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
			attendeeName: "Primary User",
			attendeeEmail: testEmail1,
			attendeePhone: testPhone,
			paymentStatus: RegistrationPaymentStatus.Free,
			verificationToken: "token_abc1",
		});

		if (reg1 && reg1.ticketId) {
			console.log(`✅ Case 1 Passed: Initial registration succeeded (Ticket: ${reg1.ticketId}).`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Initial registration failed!");
			failCount++;
		}

		// 2. Pre-check detection by phone
		const existing = await EventRegistration.findOne({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail2 }, { attendeePhone: testPhone }],
		});

		if (existing && existing.attendeePhone === testPhone) {
			console.log("✅ Case 2 Passed: Query pre-check flagged matching phone number.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Phone match was not detected!");
			failCount++;
		}

		// 3. Database unique index enforcement { eventId, attendeePhone }
		let dbDuplicateRejected = false;
		try {
			await EventRegistration.create({
				eventId: event._id,
				tierId: "commune_super_early_bird",
				tierName: "Super Early Bird Pass",
				ticketId: `FFX-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
				attendeeName: "Imposter User",
				attendeeEmail: testEmail2,
				attendeePhone: testPhone, // DUPLICATE PHONE!
				paymentStatus: RegistrationPaymentStatus.Free,
				verificationToken: "token_abc2",
			});
		} catch (err: any) {
			if (err.code === 11000) {
				dbDuplicateRejected = true;
			}
		}

		if (dbDuplicateRejected) {
			console.log("✅ Case 3 Passed: MongoDB compound index { eventId, attendeePhone } strictly enforced.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Duplicate phone was not blocked by database index!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ eventId: event._id, attendeePhone: testPhone });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 02 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
