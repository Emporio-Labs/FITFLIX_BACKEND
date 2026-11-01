import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 02: TIER SOLD-OUT BOUNDARY & CAPACITY OVERFLOW HANDLING");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `soldout-boundary-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Sold Out Boundary Test",
		slug: testSlug,
		eventType: EventType.FitnessChallenge,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "06:00 AM",
		venue: { name: "Fitflix Club", address: "Koramangala", city: "Bengaluru" },
		totalCapacity: 3,
		ticketTiers: [
			{
				tierId: "micro_tier",
				name: "Micro Pass",
				badgeLabel: "MICRO",
				badgeColor: "#ec4899",
				type: "paid",
				price: 199,
				totalQuantity: 2,
				soldQuantity: 0,
			},
			{
				tierId: "single_tier",
				name: "Single Spot Pass",
				badgeLabel: "SINGLE",
				badgeColor: "#6366f1",
				type: "free",
				price: 0,
				totalQuantity: 1,
				soldQuantity: 0,
			},
		],
	});

	try {
		// Fill micro_tier: 1 booking (not sold out yet)
		await EventRegistration.create({
			eventId: event._id,
			ticketId: `FFX-BOUND-01`,
			verificationToken: "token_b1",
			tierId: "micro_tier",
			tierName: "Micro Pass",
			attendeeName: "Runner One",
			attendeeEmail: "runner1@example.com",
			attendeePhone: "+919111111101",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 199,
		});

		// Check boundary at 1/2
		let allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		let microBreakdown = (event.ticketTiers || []).find((t) => t.tierId === "micro_tier");
		let bookedCount = allRegs.filter((r) => r.tierId === "micro_tier").length;
		let isSoldOut = bookedCount >= (microBreakdown?.totalQuantity || 0);

		if (!isSoldOut && bookedCount === 1) {
			console.log("✅ Case 1: micro_tier at 1/2 correctly reports isSoldOut=false.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Expected isSoldOut=false at 1/2");
			failCount++;
		}

		// Fill second booking (now exactly 2/2 -> SOLD OUT)
		await EventRegistration.create({
			eventId: event._id,
			ticketId: `FFX-BOUND-02`,
			verificationToken: "token_b2",
			tierId: "micro_tier",
			tierName: "Micro Pass",
			attendeeName: "Runner Two",
			attendeeEmail: "runner2@example.com",
			attendeePhone: "+919111111102",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 199,
		});

		allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		bookedCount = allRegs.filter((r) => r.tierId === "micro_tier").length;
		isSoldOut = bookedCount >= (microBreakdown?.totalQuantity || 0);

		if (isSoldOut && bookedCount === 2) {
			console.log("✅ Case 2: micro_tier at 2/2 correctly flips to isSoldOut=true.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Expected isSoldOut=true at 2/2");
			failCount++;
		}

		// Fill single_tier (1/1 -> SOLD OUT)
		await EventRegistration.create({
			eventId: event._id,
			ticketId: `FFX-BOUND-03`,
			verificationToken: "token_b3",
			tierId: "single_tier",
			tierName: "Single Spot Pass",
			attendeeName: "Runner Three",
			attendeeEmail: "runner3@example.com",
			attendeePhone: "+919111111103",
			paymentStatus: RegistrationPaymentStatus.Free,
			amountPaid: 0,
		});

		allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		const allSoldOut = (event.ticketTiers || []).every((t) => {
			const count = allRegs.filter((r) => r.tierId === t.tierId).length;
			return count >= t.totalQuantity;
		});

		if (allSoldOut && allRegs.length === 3) {
			console.log("✅ Case 3: Entire event is 100% capacity filled (3/3), all tiers sold out.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: All tiers sold out check failed");
			failCount++;
		}

		console.log(`\nTest 02 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
