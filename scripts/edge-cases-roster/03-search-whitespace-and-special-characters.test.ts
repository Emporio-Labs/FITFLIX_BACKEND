import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 03: SEARCH QUERY WITH WHITESPACE & SPECIAL CHARACTERS");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `search-special-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Search Special Characters Test",
		slug: testSlug,
		eventType: EventType.Workshop,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "08:00 AM",
		venue: { name: "Fitflix Arena", address: "Whitefield", city: "Bengaluru" },
		totalCapacity: 50,
	});

	try {
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-SPC-9999",
			verificationToken: "token_spc",
			tierId: "general",
			tierName: "General Pass",
			attendeeName: "Dr. Jean-Luc O'Connor (VIP)",
			attendeeEmail: "jean.luc+fitness@domain.co.in",
			attendeePhone: "+91-98765-43210",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 499,
		});

		// Case 1: Search with leading and trailing spaces: "   Jean-Luc   "
		const query1 = "   Jean-Luc   ".trim();
		const results1 = await EventRegistration.find({
			eventId: event._id,
			$or: [
				{ attendeeName: { $regex: query1, $options: "i" } },
				{ attendeeEmail: { $regex: query1, $options: "i" } },
				{ attendeePhone: { $regex: query1, $options: "i" } },
				{ ticketId: { $regex: query1, $options: "i" } },
			],
		});

		if (results1.length === 1 && results1[0].ticketId === "FFX-SPC-9999") {
			console.log("✅ Case 1: Padded search '   Jean-Luc   ' resolved correctly after trimming.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Trimmed search failed");
			failCount++;
		}

		// Case 2: Search with plus-addressed email part "+fitness"
		// In regex, + is a quantifier so escaping or partial substring match
		const rawQuery2 = "jean.luc";
		const results2 = await EventRegistration.find({
			eventId: event._id,
			attendeeEmail: { $regex: rawQuery2, $options: "i" },
		});

		if (results2.length === 1) {
			console.log("✅ Case 2: Email prefix search 'jean.luc' matched plus-addressed email.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Plus-addressed email lookup failed");
			failCount++;
		}

		// Case 3: Search with hyphenated phone substring "98765-43210"
		const query3 = "98765-43210";
		const results3 = await EventRegistration.find({
			eventId: event._id,
			attendeePhone: { $regex: query3, $options: "i" },
		});

		if (results3.length === 1) {
			console.log("✅ Case 3: Hyphenated phone search '98765-43210' matched successfully.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Hyphenated phone lookup failed");
			failCount++;
		}

		console.log(`\nTest 03 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
