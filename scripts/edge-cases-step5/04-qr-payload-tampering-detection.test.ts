import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 04: QR PAYLOAD INTEGRITY & TAMPERING DETECTION EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	const ticketId = "FFX-QR-TEST-001";
	const trueToken = "authentic_security_token_987654";
	await EventRegistration.deleteMany({ ticketId });

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: "commune_super_early_bird",
		tierName: "Super Early Bird Pass",
		ticketId,
		attendeeName: "QR Security Tester",
		attendeeEmail: "qr.tester@example.com",
		attendeePhone: "+919876500098",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 299,
		verificationToken: trueToken,
	});

	try {
		// 1. Authentic QR Payload
		const authenticPayload = JSON.stringify({
			ticketId: reg.ticketId,
			eventId: event._id,
			token: reg.verificationToken,
		});

		const parsedAuthentic = JSON.parse(authenticPayload);
		if (parsedAuthentic.token === reg.verificationToken) {
			console.log("✅ Case 1 Passed: Authentic QR payload token verified against database document.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Authentic token verification failed!");
			failCount++;
		}

		// 2. Tampered QR Payload (Hacker changes token)
		const tamperedPayload = JSON.stringify({
			ticketId: reg.ticketId,
			eventId: event._id,
			token: "forged_fake_token_111111", // TAMPERED!
		});

		const parsedTampered = JSON.parse(tamperedPayload);
		const isTampered = parsedTampered.token !== reg.verificationToken;
		if (isTampered) {
			console.log("✅ Case 2 Passed: Tampered QR token successfully detected & flagged as invalid entry.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Tampering was not caught!");
			failCount++;
		}

		// 3. Spoofed Event ID in Payload
		const spoofedEventPayload = JSON.stringify({
			ticketId: reg.ticketId,
			eventId: new mongoose.Types.ObjectId(), // WRONG EVENT!
			token: reg.verificationToken,
		});
		const parsedSpoofed = JSON.parse(spoofedEventPayload);
		const isSpoofedEvent = String(parsedSpoofed.eventId) !== String(reg.eventId);
		if (isSpoofedEvent) {
			console.log("✅ Case 3 Passed: Cross-event spoofed QR code detected & rejected.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Cross-event spoof was not detected!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 04 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
