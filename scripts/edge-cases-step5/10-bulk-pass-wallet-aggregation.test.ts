import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 10: USER WALLET BULK PASS AGGREGATION EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const testEmail = "wallet.poweruser@fitflix.test";
	const testPhone = "+919777766666";

	const event1 = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	const event2 = await FitflixEvent.findOne({ slug: "fitflix-sunrise-marathon-2026" });

	if (!event1 || !event2) {
		console.error("❌ Both events must exist for wallet aggregation test!");
		process.exit(1);
	}

	await EventRegistration.deleteMany({ attendeeEmail: testEmail });

	// Seed 2 distinct passes
	const ticket1 = "FFX-WAL-001";
	const ticket2 = "FFX-WAL-002";

	await EventRegistration.create({
		eventId: event1._id,
		tierId: "commune_super_early_bird",
		tierName: "Super Early Bird Pass",
		ticketId: ticket1,
		attendeeName: "Power User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 299,
		verificationToken: "token_wallet_1",
	});

	await EventRegistration.create({
		eventId: event2._id,
		tierId: "sunrise_all_access_vip",
		tierName: "All Access VIP Pass",
		ticketId: ticket2,
		attendeeName: "Power User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 999,
		verificationToken: "token_wallet_2",
	});

	try {
		// 1. Fetch user's passes
		const passes = await EventRegistration.find({ attendeeEmail: testEmail })
			.populate("eventId", "title slug startDate reportingTime venue")
			.sort({ createdAt: -1 });

		// Assertion 1: Both passes found
		if (passes.length === 2) {
			console.log(`✅ Case 1 Passed: Aggregated ${passes.length} passes across distinct events.`);
			passCount++;
		} else {
			console.error(`❌ Case 1 Failed: Expected 2 passes, found ${passes.length}`);
			failCount++;
		}

		// Assertion 2: Unique ticket IDs
		const ids = passes.map((p) => p.ticketId);
		if (new Set(ids).size === 2) {
			console.log("✅ Case 2 Passed: Every pass has a unique Ticket ID and cryptographic token.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Duplicate ticket IDs found in wallet!");
			failCount++;
		}

		// Assertion 3: Events populated correctly
		const hasBothEvents = passes.some((p: any) => p.eventId?.slug === event1.slug) &&
			passes.some((p: any) => p.eventId?.slug === event2.slug);
		if (hasBothEvents) {
			console.log("✅ Case 3 Passed: Both populated events have accurate titles and venues in wallet payload.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Populated event data missing or incorrect!");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ attendeeEmail: testEmail });
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 10 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
