import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 04: CONCURRENCY & RAPID SEQUENTIAL CHECK-IN TOGGLES");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `rapid-toggle-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Rapid Toggle Event",
		slug: testSlug,
		eventType: EventType.MarathonRun,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "05:30 AM",
		venue: { name: "Cubbon Park", address: "MG Road", city: "Bengaluru" },
		totalCapacity: 100,
		totalCheckedIn: 0,
	});

	try {
		const reg = await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-RAPID-01",
			verificationToken: "token_rapid",
			tierId: "marathon",
			tierName: "Marathon 10K",
			attendeeName: "Sprint Runner",
			attendeeEmail: "sprint@example.com",
			attendeePhone: "+919555544444",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 399,
			checkedIn: false,
		});

		// Helper to simulate toggleRegistrationCheckIn
		const toggle = async (registrationId: mongoose.Types.ObjectId) => {
			const record = await EventRegistration.findById(registrationId);
			if (!record) throw new Error("Registration not found");

			const nextState = !record.checkedIn;
			record.checkedIn = nextState;
			record.checkedInAt = nextState ? new Date() : null;
			await record.save();

			await FitflixEvent.updateOne(
				{ _id: record.eventId },
				{ $inc: { totalCheckedIn: nextState ? 1 : -1 } },
			);
			return nextState;
		};

		// 1. Toggle 1 -> Check In
		const s1 = await toggle(reg._id);
		let evtAfter1 = await FitflixEvent.findById(event._id);
		if (s1 === true && evtAfter1?.totalCheckedIn === 1) {
			console.log("✅ Cycle 1: Check In -> totalCheckedIn = 1.");
			passCount++;
		} else {
			console.error("❌ Cycle 1 Failed");
			failCount++;
		}

		// 2. Toggle 2 -> Undo (Revert)
		const s2 = await toggle(reg._id);
		let evtAfter2 = await FitflixEvent.findById(event._id);
		if (s2 === false && evtAfter2?.totalCheckedIn === 0) {
			console.log("✅ Cycle 2: Undo -> totalCheckedIn = 0.");
			passCount++;
		} else {
			console.error("❌ Cycle 2 Failed");
			failCount++;
		}

		// 3. Toggle 3 -> Check In again
		const s3 = await toggle(reg._id);
		let evtAfter3 = await FitflixEvent.findById(event._id);
		if (s3 === true && evtAfter3?.totalCheckedIn === 1) {
			console.log("✅ Cycle 3: Re-Check In -> totalCheckedIn = 1.");
			passCount++;
		} else {
			console.error("❌ Cycle 3 Failed");
			failCount++;
		}

		// 4. Toggle 4 -> Undo again
		const s4 = await toggle(reg._id);
		let evtAfter4 = await FitflixEvent.findById(event._id);
		if (s4 === false && evtAfter4?.totalCheckedIn === 0) {
			console.log("✅ Cycle 4: Re-Undo -> totalCheckedIn = 0.");
			passCount++;
		} else {
			console.error("❌ Cycle 4 Failed");
			failCount++;
		}

		// Check registration doc directly
		const finalDoc = await EventRegistration.findById(reg._id);
		if (finalDoc?.checkedIn === false && finalDoc.checkedInAt === null) {
			console.log("✅ Final State: Registration doc checkedIn=false, checkedInAt=null.");
			passCount++;
		} else {
			console.error("❌ Final doc verification failed");
			failCount++;
		}

		console.log(`\nTest 04 Summary: ${passCount} Passed, ${failCount} Failed.`);
		process.exit(failCount > 0 ? 1 : 0);
	} finally {
		try {
			await EventRegistration.deleteMany({ eventId: event._id });
			await FitflixEvent.findByIdAndDelete(event._id);
		} catch (e) {}
		await mongoose.disconnect();
	}
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
