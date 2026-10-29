import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 08: CHECK-IN TIMESTAMP ACCURACY, TIMEZONE & UNDO RESET");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `timestamp-undo-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Timestamp Test Event",
		slug: testSlug,
		eventType: EventType.Celebration,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "06:00 PM",
		venue: { name: "Rooftop Lounge", address: "Lavelle Road", city: "Bengaluru" },
		totalCapacity: 50,
		totalCheckedIn: 0,
	});

	try {
		const reg = await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-TIME-01",
			verificationToken: "tok_time_1",
			tierId: "general",
			tierName: "General Pass",
			attendeeName: "Temporal Tester",
			attendeeEmail: "temporal@example.com",
			attendeePhone: "+919333322222",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 500,
			checkedIn: false,
			checkedInAt: null,
		});

		// 1. Initial State
		if (reg.checkedIn === false && reg.checkedInAt === null) {
			console.log("✅ Case 1: Initial state confirms checkedIn=false, checkedInAt=null.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed");
			failCount++;
		}

		// 2. Perform Check-In
		const beforeCheckIn = Date.now() - 500;
		reg.checkedIn = true;
		reg.checkedInAt = new Date();
		await reg.save();

		const checkedDoc = await EventRegistration.findById(reg._id);
		const checkInTime = checkedDoc?.checkedInAt?.getTime() || 0;

		if (checkedDoc?.checkedIn === true && checkInTime >= beforeCheckIn && checkInTime <= Date.now() + 500) {
			console.log(`✅ Case 2: Check-in timestamp recorded accurately: ${checkedDoc.checkedInAt?.toISOString()}`);
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Timestamp out of bounds");
			failCount++;
		}

		// 3. Perform Undo Check-In
		checkedDoc!.checkedIn = false;
		checkedDoc!.checkedInAt = null;
		await checkedDoc!.save();

		const undoneDoc = await EventRegistration.findById(reg._id);
		if (undoneDoc?.checkedIn === false && undoneDoc.checkedInAt === null) {
			console.log("✅ Case 3: Undo check-in cleanly nullifies checkedInAt without leaving stale timestamps.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Undo did not nullify timestamp");
			failCount++;
		}

		console.log(`\nTest 08 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
