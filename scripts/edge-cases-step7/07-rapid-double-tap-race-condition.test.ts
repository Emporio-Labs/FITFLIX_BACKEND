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
	console.log("🧪 STEP 7 EDGE CASE 07: RAPID DOUBLE-TAP CONCURRENCY RACE CONDITION");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found!");
		process.exit(1);
	}

	const testEmail = "doubletap.racer@fitflix.in";
	const testPhone = "+919999900077";

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	try {
		// Launch 2 registration requests simultaneously in parallel (Promise.allSettled)
		const createCall = (i: number) =>
			EventRegistration.create({
				eventId: event._id,
				tierId: "general",
				tierName: "General Access",
				ticketId: `FFX-RACE-${i}-${Date.now()}`,
				attendeeName: "Double-Tap Racer",
				attendeeEmail: testEmail,
				attendeePhone: testPhone,
				paymentStatus: RegistrationPaymentStatus.Paid,
				verificationToken: crypto.randomBytes(16).toString("hex"),
			});

		console.log("🚀 Executing twin concurrent registration writes at identical millisecond...");
		const results = await Promise.allSettled([createCall(1), createCall(2)]);

		const fulfilled = results.filter((r) => r.status === "fulfilled");
		const rejected = results.filter((r) => r.status === "rejected");

		console.log(`Results: ${fulfilled.length} fulfilled, ${rejected.length} rejected by unique constraint.`);

		// 1. Exactly 1 write must succeed, the other rejected with E11000 duplicate key
		if (fulfilled.length === 1 && rejected.length === 1) {
			console.log("✅ Step 1: Database compound unique index cleanly intercepted concurrent double-tap race.");
			passCount++;
		} else if (fulfilled.length === 1 && rejected.length === 0) {
			console.log("✅ Step 1: Serialized successfully without duplicate insertion.");
			passCount++;
		} else {
			console.error(`❌ Step 1 failed: Unexpected concurrency counts (fulfilled: ${fulfilled.length}, rejected: ${rejected.length})`);
			failCount++;
		}

		// 2. Strict document count verification
		const totalCreated = await EventRegistration.countDocuments({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});

		if (totalCreated === 1) {
			console.log("✅ Step 2: Database integrity confirmed: strictly 1 pass exists.");
			passCount++;
		} else {
			console.error(`❌ Step 2 failed: Multiple pass records created! count: ${totalCreated}`);
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			eventId: event._id,
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		});
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
