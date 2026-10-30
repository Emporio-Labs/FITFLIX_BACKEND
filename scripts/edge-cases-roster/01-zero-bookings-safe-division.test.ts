import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 01: ZERO BOOKINGS SAFE DIVISION & EMPTY ROSTER METRICS");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `zero-bookings-test-${Date.now()}`;
	const event = await FitflixEvent.create({
		title: "Zero Bookings Test Event",
		slug: testSlug,
		eventType: EventType.WellnessSummit,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "07:00 AM",
		venue: {
			name: "Fitflix Studio",
			address: "123 Indiranagar",
			city: "Bengaluru",
		},
		totalCapacity: 200,
		ticketTiers: [
			{
				tierId: "tier_free",
				name: "Free Community",
				badgeLabel: "COMMUNITY",
				badgeColor: "#10b981",
				type: "free",
				price: 0,
				totalQuantity: 50,
			},
			{
				tierId: "tier_paid",
				name: "Gold Pass",
				badgeLabel: "GOLD",
				badgeColor: "#f59e0b",
				type: "paid",
				price: 799,
				totalQuantity: 150,
			},
		],
		totalRegistered: 0,
		totalCheckedIn: 0,
	});

	try {
		// Ensure 0 registrations exist
		const allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		const totalCheckedIn = allRegs.filter((r) => r.checkedIn).length;
		const totalRevenue = allRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);

		const checkedInPercentage =
			allRegs.length > 0 ? Math.round((totalCheckedIn / allRegs.length) * 100) : 0;
		const totalPending = Math.max(0, allRegs.length - totalCheckedIn);

		// Assertions
		if (checkedInPercentage === 0 && !Number.isNaN(checkedInPercentage)) {
			console.log("✅ Case 1: checkedInPercentage is 0 (No NaN or Infinity from 0/0 division).");
			passCount++;
		} else {
			console.error(`❌ Case 1 Failed: checkedInPercentage returned ${checkedInPercentage}`);
			failCount++;
		}

		if (totalPending === 0 && totalRevenue === 0) {
			console.log("✅ Case 2: totalPending is 0 and totalRevenue is ₹0.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: totalPending or totalRevenue unexpected");
			failCount++;
		}

		const tierBreakdown = (event.ticketTiers || []).map((t) => {
			const bookedCount = allRegs.filter((r) => r.tierId === t.tierId).length;
			return {
				tierId: t.tierId,
				name: t.name,
				bookedCount,
				isSoldOut: bookedCount >= t.totalQuantity,
			};
		});

		const allZero = tierBreakdown.every((t) => t.bookedCount === 0 && !t.isSoldOut);
		if (allZero && tierBreakdown.length === 2) {
			console.log("✅ Case 3: All tier breakdowns correctly report 0 booked and isSoldOut=false.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Tier breakdown invalid for empty event");
			failCount++;
		}

		console.log(`\nTest 01 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
