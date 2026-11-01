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
	console.log("🧪 STEP 8 EDGE CASE 09: DUPLICATE CHECK-IN IDEMPOTENCY & TIMESTAMP IMMUTABILITY");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketId = `FFX-IDEM-${Math.floor(1000 + Math.random() * 9000)}`;
	const testEmail = "idempotency.audit.test@fitflix.in";
	const testPhone = "+919999908012";

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId,
		attendeeName: "Audit Test Attendee",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	try {
		// 1. Initial check-in at T0
		const t0 = new Date("2026-11-01T09:00:00.000Z");
		const firstScan = await EventRegistration.findOneAndUpdate(
			{ _id: reg._id, checkedIn: false },
			{
				$set: {
					checkedIn: true,
					checkedInAt: t0,
					checkInNotes: "Turnstile Gate 1 - Initial Scan",
				},
			},
			{ returnDocument: "after" },
		);

		if (firstScan && firstScan.checkedIn && firstScan.checkedInAt?.getTime() === t0.getTime()) {
			console.log(`✅ Step 1: Initial entrance check-in stamped at T0 (${t0.toISOString()}).`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed to stamp initial check-in.");
			failCount++;
		}

		// 2. Accidental double scan 45 seconds later (T1)
		const t1 = new Date("2026-11-01T09:00:45.000Z");
		const secondScanAttempt = await EventRegistration.findOneAndUpdate(
			{ _id: reg._id, checkedIn: false },
			{
				$set: {
					checkedIn: true,
					checkedInAt: t1,
					checkInNotes: "Turnstile Gate 1 - Re-scan",
				},
			},
			{ returnDocument: "after" },
		);

		// Concurrency guard returns null because checkedIn was already true
		if (secondScanAttempt === null) {
			console.log("✅ Step 2: Second scan attempt 45s later correctly intercepted and blocked by atomic condition.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed: Second scan overwritten document.");
			failCount++;
		}

		// 3. Confirm Original Timestamp Immutability in Database
		const auditRecord = await EventRegistration.findById(reg._id);
		const timestampPreserved = auditRecord?.checkedInAt?.getTime() === t0.getTime();
		const notesPreserved = auditRecord?.checkInNotes === "Turnstile Gate 1 - Initial Scan";

		if (timestampPreserved && notesPreserved) {
			console.log(`✅ Step 3: Verified original timestamp '${auditRecord?.checkedInAt?.toISOString()}' is 100% immutable for audit compliance.`);
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Original timestamp was corrupted or overwritten.");
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
