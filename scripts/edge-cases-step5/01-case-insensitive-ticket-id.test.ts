import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 01: CASE-INSENSITIVE TICKET ID RESOLUTION EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	const ticketIdUpper = "FFX-CASE-1234";
	await EventRegistration.deleteMany({ ticketId: ticketIdUpper });

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: "commune_super_early_bird",
		tierName: "Super Early Bird Pass",
		ticketId: ticketIdUpper,
		attendeeName: "Case Sensitivity Tester",
		attendeeEmail: "case.tester@example.com",
		attendeePhone: "+919876500099",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 299,
		verificationToken: "token_case_test",
	});

	try {
		// Test 1: Lowercase input "ffx-case-1234"
		const inputLower = "ffx-case-1234";
		const normalized1 = inputLower.trim().toUpperCase();
		const match1 = await EventRegistration.findOne({ ticketId: normalized1 });
		if (match1 && match1.ticketId === ticketIdUpper) {
			console.log(`✅ Case 1 Passed: Lowercase input '${inputLower}' resolved to uppercase ticket '${match1.ticketId}'.`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Lowercase ticketId resolution failed!");
			failCount++;
		}

		// Test 2: Mixed-case input "FfX-CaSe-1234"
		const inputMixed = "FfX-CaSe-1234";
		const normalized2 = inputMixed.trim().toUpperCase();
		const match2 = await EventRegistration.findOne({ ticketId: normalized2 });
		if (match2 && match2.ticketId === ticketIdUpper) {
			console.log(`✅ Case 2 Passed: Mixed-case input '${inputMixed}' resolved to '${match2.ticketId}'.`);
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Mixed-case resolution failed!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId: ticketIdUpper });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 01 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
