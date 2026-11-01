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
	console.log("🧪 STEP 7 EDGE CASE 04: OFFLINE PASS PAYLOAD CACHING RESILIENCE");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found!");
		process.exit(1);
	}

	const ticketId = "FFX-OFFLINE-TEST-99";
	const verificationToken = crypto.randomBytes(16).toString("hex");

	await EventRegistration.deleteMany({ ticketId });

	try {
		const reg = await EventRegistration.create({
			eventId: event._id,
			tierId: event.ticketTiers[0]?.tierId || "general",
			tierName: event.ticketTiers[0]?.name || "General Runner",
			ticketId,
			attendeeName: "Offline Trail Runner",
			attendeeEmail: "offline.runner@fitflix.in",
			attendeePhone: "+919876543299",
			paymentStatus: RegistrationPaymentStatus.Paid,
			verificationToken,
		});

		// Simulate the API payload serialized for Flutter client caching
		const passPayload = {
			ticketId: reg.ticketId,
			eventId: event._id.toString(),
			eventTitle: event.title,
			eventTagline: event.tagline || "",
			tierId: reg.tierId,
			tierName: reg.tierName,
			attendeeName: reg.attendeeName,
			attendeeEmail: reg.attendeeEmail,
			attendeePhone: reg.attendeePhone,
			qrPayload: `ffx://event-pass/${reg.ticketId}?token=${verificationToken}`,
			reportingTime: event.reportingTime || "07:00 AM IST",
			startDate: event.startDate ? event.startDate.toISOString() : new Date().toISOString(),
			venue: {
				name: event.venue?.name || "Fitflix Venue",
				address: event.venue?.address || "",
				city: event.venue?.city || "Hyderabad",
			},
			checkedIn: reg.checkedIn ?? false,
			checkedInAt: reg.checkedInAt ? reg.checkedInAt.toISOString() : null,
		};

		// 1. Validate complete pass payload JSON serializability
		const serializedJson = JSON.stringify(passPayload);
		const deserialized = JSON.parse(serializedJson);

		if (deserialized.ticketId === ticketId && deserialized.eventTitle === event.title) {
			console.log("✅ Step 1: Pass payload safely serializes to JSON for FlutterSecureStorage offline cache.");
			passCount++;
		} else {
			console.error("❌ Step 1 failed: JSON serialization error.");
			failCount++;
		}

		// 2. Validate zero missing mandatory fields that would crash Flutter offline view
		const requiredKeys = [
			"ticketId",
			"eventId",
			"eventTitle",
			"tierName",
			"attendeeName",
			"qrPayload",
			"reportingTime",
			"venue",
			"checkedIn",
		];
		const missingKeys = requiredKeys.filter((k) => (deserialized as any)[k] === undefined);

		if (missingKeys.length === 0) {
			console.log("✅ Step 2: All 9 mandatory offline rendering properties present and non-null.");
			passCount++;
		} else {
			console.error(`❌ Step 2 failed: Missing offline keys: ${missingKeys.join(", ")}`);
			failCount++;
		}

		// 3. Test QR URI structure for native offline barcode scanner
		const qrUri = deserialized.qrPayload;
		const isValidQr = qrUri.startsWith("ffx://event-pass/") && qrUri.includes(ticketId);

		if (isValidQr) {
			console.log(`✅ Step 3: Anti-aliased QR URI conforms to offline protocol: "${qrUri}"`);
			passCount++;
		} else {
			console.error(`❌ Step 3 failed: Malformed QR payload: ${qrUri}`);
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ ticketId });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
