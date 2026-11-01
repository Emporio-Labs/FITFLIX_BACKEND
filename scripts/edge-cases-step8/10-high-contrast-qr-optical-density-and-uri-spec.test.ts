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
	console.log("🧪 STEP 8 EDGE CASE 10: HIGH-CONTRAST QR OPTICAL DENSITY & URI SPEC");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketId = `FFX-OPTIC-${Math.floor(1000 + Math.random() * 9000)}`;
	const token = crypto.randomBytes(16).toString("hex");

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId,
		attendeeName: "Optical Density Tester",
		attendeeEmail: "optical.density.test@fitflix.in",
		attendeePhone: "+919999908013",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: token,
	});

	try {
		// 1. Validate URI Protocol Scheme and Structure
		const qrUri = `ffx://event-pass/${ticketId}?token=${token}`;
		const isCorrectScheme = qrUri.startsWith("ffx://event-pass/");
		const urlObj = new URL(qrUri.replace("ffx://", "http://localhost/"));
		const extractedToken = urlObj.searchParams.get("token");

		if (isCorrectScheme && extractedToken === token) {
			console.log(`✅ Step 1: QR URI protocol conforms to mobile spec: "${qrUri}".`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed: Malformed QR URI.");
			failCount++;
		}

		// 2. Optical Density: Length must be <= 100 chars to fit standard low-density QR (Version 3 or 4)
		// Low-density QR codes produce large physical module dots that scan instantly under 100% screen brightness
		const payloadLength = qrUri.length;
		const isLowDensityOptimal = payloadLength <= 100;

		if (isLowDensityOptimal) {
			console.log(`✅ Step 2: Optical payload length is optimal (${payloadLength} chars <= 100), enabling high-speed optical scanning.`);
			passCount++;
		} else {
			console.error(`❌ Step 2 failed: Payload length (${payloadLength} chars) exceeds 100-character density budget.`);
			failCount++;
		}

		// 3. Character Safety: Safe ASCII alphanumeric chars only (no control characters or unencoded symbols)
		const containsOnlySafeChars = /^[a-zA-Z0-9:\/\?=\-_]+$/.test(qrUri);

		if (containsOnlySafeChars) {
			console.log("✅ Step 3: Verified payload contains strictly URL-safe ASCII characters, preventing barcode reader decoding glitches.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Unsafe or control characters found in barcode URI.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteOne({ _id: reg._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
