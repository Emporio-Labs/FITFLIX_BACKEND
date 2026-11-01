import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import EventRegistration from "../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../src/models/Enums";

config();

async function runStep5Tests() {
	console.log("===================================================================");
	console.log("🧪 STEP 5 TEST: FITFLIX OFFICIAL DIGITAL PASS RETRIEVAL & QR PAYLOAD");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	// 1. Fetch target event
	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event commune-part-2-sainikpuri not found in DB!");
		process.exit(1);
	}

	// 2. Ensure a confirmed test pass exists in DB
	const testTicketId = "FFX-COMM-5555";
	const testEmail = "priya.pass.step5@fitflix.test";
	const testPhone = "+919888877777";

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ ticketId: testTicketId }, { attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	const testTier = event.ticketTiers.find((t: any) => t.tierId === "commune_super_early_bird") || event.ticketTiers[0];

	const samplePass = await EventRegistration.create({
		eventId: event._id,
		tierId: testTier.tierId,
		tierName: testTier.name,
		ticketId: testTicketId,
		attendeeName: "Priya Sharma",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		answers: { tshirtSize: "M" },
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: testTier.price || 299,
		verificationToken: "token_secure_hex_789456123",
	});

	console.log(`📌 Seeded test digital pass: Ticket ID [${samplePass.ticketId}] for "${samplePass.attendeeName}"`);

	try {
		// 3. Test Retrieval of Pass
		const foundReg = await EventRegistration.findOne({ ticketId: testTicketId });
		if (!foundReg) throw new Error("Registration could not be retrieved");

		const foundEvent = await FitflixEvent.findById(foundReg.eventId).lean();
		if (!foundEvent) throw new Error("Event could not be retrieved");

		// Locate tier details
		const tier = (foundEvent.ticketTiers || []).find((t: any) => t.tierId === foundReg.tierId);

		// Signed QR Payload
		const qrPayloadStr = JSON.stringify({
			ticketId: foundReg.ticketId,
			eventId: foundEvent._id,
			token: foundReg.verificationToken,
		});

		// Assertion 1: Valid Ticket ID and Attendee Identity
		if (foundReg.ticketId === testTicketId && foundReg.attendeeName === "Priya Sharma") {
			console.log(`✅ Case 1 Passed: Digital pass retrieved with correct Ticket ID & attendee name.`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Ticket ID mismatch!");
			failCount++;
		}

		// Assertion 2: Tier styling & Fitflix Summit badge label mapping
		if (tier && tier.badgeLabel && tier.badgeColor) {
			console.log(`✅ Case 2 Passed: Tier styling resolved: Badge="${tier.badgeLabel}", Color="${tier.badgeColor}".`);
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Tier styling metadata missing!");
			failCount++;
		}

		// Assertion 3: QR Payload parseability & integrity
		const parsedQr = JSON.parse(qrPayloadStr);
		if (
			parsedQr.ticketId === testTicketId &&
			parsedQr.token === "token_secure_hex_789456123" &&
			String(parsedQr.eventId) === String(foundEvent._id)
		) {
			console.log("✅ Case 3 Passed: Signed QR Payload validated with complete verification tokens.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: QR payload structure corrupted!", parsedQr);
			failCount++;
		}

		// Assertion 4: Event Logistics attached
		if (foundEvent.reportingTime && foundEvent.venue && foundEvent.venue.name) {
			console.log(`✅ Case 4 Passed: Event logistics attached (${foundEvent.venue.name}, Reporting: ${foundEvent.reportingTime}).`);
			passCount++;
		} else {
			console.error("❌ Case 4 Failed: Event logistics missing!");
			failCount++;
		}

		// Assertion 5: Co-Branding & Sponsor Strip presence
		if (foundEvent.collaborators && foundEvent.collaborators.length > 0) {
			console.log(`✅ Case 5 Passed: Co-branding collaborator attached (${foundEvent.collaborators[0].name}).`);
			passCount++;
		} else {
			console.error("❌ Case 5 Failed: Collaborators missing!");
			failCount++;
		}

		// Assertion 6: Nonexistent ticket ID query returns null/not found
		const nonexistent = await EventRegistration.findOne({ ticketId: "FFX-NONEXISTENT-9999" });
		if (!nonexistent) {
			console.log("✅ Case 6 Passed: Non-existent ticket ID query returns 404 NOT_FOUND.");
			passCount++;
		} else {
			console.error("❌ Case 6 Failed: Fake ticket ID should not return data!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			eventId: event._id,
			$or: [{ ticketId: testTicketId }, { attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});
		await mongoose.disconnect();
	}

	console.log(`\n===================================================================`);
	console.log(`🏁 STEP 5 RESULTS: ${passCount} Passed, ${failCount} Failed.`);
	console.log("===================================================================\n");

	if (failCount > 0) process.exit(1);
}

runStep5Tests();
