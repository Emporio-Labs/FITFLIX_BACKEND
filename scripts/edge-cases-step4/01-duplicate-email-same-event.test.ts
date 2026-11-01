import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 01: DUPLICATE EMAIL REGISTRATION EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const testEmail = "test.dup.email@example.com";
	const testPhone1 = "+919876500001";
	const testPhone2 = "+919876500002";

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	// Clean up any leftovers
	await EventRegistration.deleteMany({ eventId: event._id, attendeeEmail: testEmail });

	try {
		// 1. First registration should succeed
		const reg1 = await EventRegistration.create({
			eventId: event._id,
			tierId: "commune_super_early_bird",
			tierName: "Super Early Bird Pass",
			ticketId: `FFX-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
			attendeeName: "Original Registrant",
			attendeeEmail: testEmail,
			attendeePhone: testPhone1,
			paymentStatus: RegistrationPaymentStatus.Free,
			verificationToken: "token_123456",
		});

		if (reg1 && reg1.ticketId) {
			console.log(`✅ Case 1 Passed: First registration succeeded (Ticket: ${reg1.ticketId}).`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: First registration failed!");
			failCount++;
		}

		// 2. Second registration attempt with identical email but different phone
		let duplicateCaught = false;
		const existing = await EventRegistration.findOne({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone2 }],
		});

		if (existing && existing.attendeeEmail === testEmail) {
			duplicateCaught = true;
		}

		// Also verify database unique index rejects if bypass attempted
		let dbDuplicateRejected = false;
		try {
			await EventRegistration.create({
				eventId: event._id,
				tierId: "commune_super_early_bird",
				tierName: "Super Early Bird Pass",
				ticketId: `FFX-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
				attendeeName: "Duplicate Attempt",
				attendeeEmail: testEmail, // DUPLICATE!
				attendeePhone: testPhone2,
				paymentStatus: RegistrationPaymentStatus.Free,
				verificationToken: "token_999999",
			});
		} catch (err: any) {
			if (err.code === 11000) {
				dbDuplicateRejected = true;
			}
		}

		if (duplicateCaught) {
			console.log("✅ Case 2 Passed: Pre-check duplicate check detected duplicate email.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Pre-check failed to catch duplicate email!");
			failCount++;
		}

		if (dbDuplicateRejected) {
			console.log("✅ Case 3 Passed: MongoDB unique compound index { eventId, attendeeEmail } enforced.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Unique index did not reject duplicate email!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ eventId: event._id, attendeeEmail: testEmail });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 01 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
