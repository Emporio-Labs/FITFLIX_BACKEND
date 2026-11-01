import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 05: PAYMENT STATUS FILTERING & REVENUE SUMMATION INTEGRITY");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `payment-filter-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Payment Filter Test Event",
		slug: testSlug,
		eventType: EventType.Masterclass,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "10:00 AM",
		venue: { name: "Fitflix Hub", address: "HSR Layout", city: "Bengaluru" },
		totalCapacity: 100,
	});

	try {
		// 1. Paid VIP 1499
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-PAY-01",
			verificationToken: "tok_p1",
			tierId: "vip",
			tierName: "VIP Pass",
			attendeeName: "VIP Member",
			attendeeEmail: "vip@example.com",
			attendeePhone: "+919777711111",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 1499,
		});

		// 2. Paid Regular 499
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-PAY-02",
			verificationToken: "tok_p2",
			tierId: "regular",
			tierName: "Regular Pass",
			attendeeName: "Regular Member",
			attendeeEmail: "regular@example.com",
			attendeePhone: "+919777722222",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 499,
		});

		// 3. Free RSVP 0
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-PAY-03",
			verificationToken: "tok_p3",
			tierId: "community",
			tierName: "Community Pass",
			attendeeName: "Free Member",
			attendeeEmail: "free@example.com",
			attendeePhone: "+919777733333",
			paymentStatus: RegistrationPaymentStatus.Free,
			amountPaid: 0,
		});

		// Query 1: Filter by 'paid'
		const paidQuery = await EventRegistration.find({
			eventId: event._id,
			paymentStatus: RegistrationPaymentStatus.Paid,
		});

		if (paidQuery.length === 2) {
			const paidSum = paidQuery.reduce((acc, r) => acc + (r.amountPaid || 0), 0);
			if (paidSum === 1998) {
				console.log("✅ Case 1: Filter paymentStatus='paid' returned 2 records with sum ₹1998.");
				passCount++;
			} else {
				console.error(`❌ Case 1: Expected sum 1998, got ${paidSum}`);
				failCount++;
			}
		} else {
			console.error(`❌ Case 1: Expected 2 paid records, got ${paidQuery.length}`);
			failCount++;
		}

		// Query 2: Filter by 'free'
		const freeQuery = await EventRegistration.find({
			eventId: event._id,
			paymentStatus: RegistrationPaymentStatus.Free,
		});

		if (freeQuery.length === 1 && freeQuery[0].amountPaid === 0) {
			console.log("✅ Case 2: Filter paymentStatus='free' returned 1 free RSVP with amountPaid ₹0.");
			passCount++;
		} else {
			console.error(`❌ Case 2 Failed`);
			failCount++;
		}

		// Total revenue independent of filter
		const allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		const totalRevenue = allRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
		if (totalRevenue === 1998) {
			console.log("✅ Case 3: Overall event totalRevenue correctly computed as ₹1998.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed");
			failCount++;
		}

		console.log(`\nTest 05 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
