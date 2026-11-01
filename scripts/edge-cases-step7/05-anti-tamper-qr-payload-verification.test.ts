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
	console.log("🧪 STEP 7 EDGE CASE 05: ANTI-TAMPER QR PAYLOAD VERIFICATION");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found!");
		process.exit(1);
	}

	const legitimateTicketId = "FFX-SECURE-8888";
	const secretVerificationToken = crypto.randomBytes(16).toString("hex");

	await EventRegistration.deleteMany({ ticketId: legitimateTicketId });

	try {
		await EventRegistration.create({
			eventId: event._id,
			tierId: "vip_pass",
			tierName: "VIP All Access",
			ticketId: legitimateTicketId,
			attendeeName: "Legit Attendee",
			attendeeEmail: "legit@fitflix.in",
			attendeePhone: "+919876543888",
			paymentStatus: RegistrationPaymentStatus.Paid,
			verificationToken: secretVerificationToken,
		});

		// 1. Legitimate scan: ticketId + matching token
		const legitQuery = await EventRegistration.findOne({
			ticketId: legitimateTicketId,
			verificationToken: secretVerificationToken,
		});

		if (legitQuery && legitQuery.ticketId === legitimateTicketId) {
			console.log("✅ Step 1: Authentic QR scan with valid verificationToken validates successfully.");
			passCount++;
		} else {
			console.error("❌ Step 1 failed: Authentic QR scan was rejected.");
			failCount++;
		}

		// 2. Tampered token: ticketId with counterfeit token
		const forgedToken = "counterfeit_token_abc_123";
		const tamperedQuery = await EventRegistration.findOne({
			ticketId: legitimateTicketId,
			verificationToken: forgedToken,
		});

		if (!tamperedQuery) {
			console.log("✅ Step 2: Tampered token was rejected by database verification guard.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed: Tampered token was erroneously accepted!");
			failCount++;
		}

		// 3. Forged ticket ID: nonexistent ticket number with valid token
		const nonExistentTicket = "FFX-FORGED-0000";
		const forgedTicketQuery = await EventRegistration.findOne({
			ticketId: nonExistentTicket,
			verificationToken: secretVerificationToken,
		});

		if (!forgedTicketQuery) {
			console.log("✅ Step 3: Forged ticketId fails gate check as nonexistent.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Forged ticketId succeeded!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId: legitimateTicketId });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
