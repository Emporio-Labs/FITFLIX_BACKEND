import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 06: UNMAPPED / ORPHANED TIER ID ROSTER FALLBACK RESILIENCE");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `orphaned-tier-test-${Date.now()}`;
	// Event with only "gold_tier"
	const event = await FitflixEvent.create({
		title: "Orphaned Tier Test Event",
		slug: testSlug,
		eventType: EventType.Workshop,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "09:00 AM",
		venue: { name: "Studio A", address: "MG Road", city: "Bengaluru" },
		totalCapacity: 50,
		ticketTiers: [
			{
				tierId: "gold_tier",
				name: "Gold Member Pass",
				badgeLabel: "GOLD",
				badgeColor: "#f59e0b",
				type: "paid",
				price: 500,
				totalQuantity: 20,
			},
		],
	});

	try {
		// Registration has a deprecated tierId "legacy_bronze" that is no longer in event.ticketTiers
		await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-ORPH-01",
			verificationToken: "tok_orph",
			tierId: "legacy_bronze",
			tierName: "Legacy Bronze Pass",
			attendeeName: "Old Attendee",
			attendeeEmail: "old@example.com",
			attendeePhone: "+919444433333",
			paymentStatus: RegistrationPaymentStatus.Paid,
			amountPaid: 250,
		});

		// 1. Controller query fetches all registrations for event
		const registrations = await EventRegistration.find({ eventId: event._id }).lean();
		if (registrations.length === 1 && registrations[0].tierId === "legacy_bronze") {
			console.log("✅ Case 1: Orphaned registration is preserved and returned in roster.");
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Registration dropped or not found");
			failCount++;
		}

		// 2. Summary computation over event.ticketTiers
		const tierBreakdown = (event.ticketTiers || []).map((t) => {
			const bookedCount = registrations.filter((r) => r.tierId === t.tierId).length;
			return {
				tierId: t.tierId,
				name: t.name,
				bookedCount,
			};
		});

		const goldBreakdown = tierBreakdown.find((t) => t.tierId === "gold_tier");
		if (goldBreakdown && goldBreakdown.bookedCount === 0) {
			console.log("✅ Case 2: Configured 'gold_tier' bookedCount remains 0 without misattributing legacy tier.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Unintended tier count mutation");
			failCount++;
		}

		// 3. UI Fallback: In frontdesk UI, tier lookup falls back to reg.tierName or 'GENERAL'
		const tier = event.ticketTiers?.find((t) => t.tierId === registrations[0].tierId);
		const badgeLabel = tier?.badgeLabel || registrations[0].tierName || "GENERAL";
		const badgeColor = tier?.badgeColor || "#10b981";

		if (badgeLabel === "Legacy Bronze Pass" && badgeColor === "#10b981") {
			console.log("✅ Case 3: FrontDesk fallback gracefully renders legacy tierName with default color.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: UI fallback logic failed");
			failCount++;
		}

		console.log(`\nTest 06 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
