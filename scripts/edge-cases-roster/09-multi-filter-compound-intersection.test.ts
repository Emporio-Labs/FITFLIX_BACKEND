import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 09: MULTI-FILTER COMPOUND INTERSECTION IN ROSTER TABLE");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `multi-filter-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Multi Filter Test Event",
		slug: testSlug,
		eventType: EventType.FitnessChallenge,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "07:30 AM",
		venue: { name: "Fitflix Club", address: "Bellandur", city: "Bengaluru" },
		totalCapacity: 100,
	});

	try {
		// Populate 4 distinct attendee permutations
		// A: Name "Kavita", VIP, Paid, CheckedIn=true
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-MF-01",
			verificationToken: "tok_mf1",
			tierId: "vip",
			tierName: "VIP Pass",
			attendeeName: "Kavita Rao",
			attendeeEmail: "kavita.rao@example.com",
			attendeePhone: "+919222211111",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 999,
			checkedIn: true,
			checkedInAt: new Date(),
		});

		// B: Name "Kavita", Regular, Paid, CheckedIn=false
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-MF-02",
			verificationToken: "tok_mf2",
			tierId: "regular",
			tierName: "Regular Pass",
			attendeeName: "Kavita Nair",
			attendeeEmail: "kavita.nair@example.com",
			attendeePhone: "+919222222222",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 499,
			checkedIn: false,
		});

		// C: Name "Rohan", VIP, Paid, CheckedIn=true
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-MF-03",
			verificationToken: "tok_mf3",
			tierId: "vip",
			tierName: "VIP Pass",
			attendeeName: "Rohan Das",
			attendeeEmail: "rohan@example.com",
			attendeePhone: "+919222233333",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 999,
			checkedIn: true,
			checkedInAt: new Date(),
		});

		// D: Name "Kavita", VIP, Free, CheckedIn=false
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-MF-04",
			verificationToken: "tok_mf4",
			tierId: "vip",
			tierName: "VIP Pass",
			attendeeName: "Kavita Singh",
			attendeeEmail: "kavita.singh@example.com",
			attendeePhone: "+919222244444",
			paymentStatus: RegistrationPaymentStatus.Free,
			amountPaid: 0,
			checkedIn: false,
		});

		// Compound Query:
		// Search: "Kavita" AND Tier: "vip" AND CheckedIn: true AND Payment: "paid"
		const filter: Record<string, any> = {
			eventId: event._id,
			tierId: "vip",
			checkedIn: true,
			paymentStatus: RegistrationPaymentStatus.Paid,
			$or: [
				{ attendeeName: { $regex: "kavita", $options: "i" } },
				{ attendeeEmail: { $regex: "kavita", $options: "i" } },
			],
		};

		const matched = await EventRegistration.find(filter);

		if (matched.length === 1 && matched[0].ticketId === "FFX-MF-01") {
			console.log("✅ Case 1: 4-condition compound filter correctly narrowed down to exact single attendee: Kavita Rao.");
			passCount++;
		} else {
			console.error(`❌ Case 1 Failed: Expected 1 match, got ${matched.length}`);
			failCount++;
		}

		// Verify other combinations
		// Filter: search="Kavita", tier="vip" (should match Kavita Rao and Kavita Singh = 2)
		const matched2 = await EventRegistration.find({
			eventId: event._id,
			tierId: "vip",
			attendeeName: { $regex: "kavita", $options: "i" },
		});

		if (matched2.length === 2) {
			console.log("✅ Case 2: 2-condition filter (name + tier) returned both expected candidates.");
			passCount++;
		} else {
			console.error(`❌ Case 2 Failed: Expected 2 matches, got ${matched2.length}`);
			failCount++;
		}

		console.log(`\nTest 09 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
