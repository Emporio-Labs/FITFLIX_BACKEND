import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 10: HIGH-VOLUME ATTENDEE ROSTER STRESS & QUERY SPEED");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const testSlug = `stress-roster-test-${Date.now()}`;
	const totalAttendees = 60;
	const event = await FitflixEvent.create({
		title: "High Volume Stress Test Event",
		slug: testSlug,
		eventType: EventType.MarathonRun,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "05:00 AM",
		venue: { name: "Bangalore Stadium", address: "Kanteerava", city: "Bengaluru" },
		totalCapacity: 500,
		ticketTiers: [
			{
				tierId: "tier_early",
				name: "Early Bird",
				badgeLabel: "EARLY",
				badgeColor: "#10b981",
				type: "paid",
				price: 399,
				totalQuantity: 30,
			},
			{
				tierId: "tier_regular",
				name: "Regular",
				badgeLabel: "REGULAR",
				badgeColor: "#3b82f6",
				type: "paid",
				price: 599,
				totalQuantity: 100,
			},
		],
	});

	try {
		console.log(`Generating and inserting ${totalAttendees} test attendees in bulk...`);
		const docs = [];
		for (let i = 1; i <= totalAttendees; i++) {
			const isEarly = i <= 30;
			const isCheckedIn = i % 3 === 0; // 20 attendees checked in
			docs.push({
				eventId: event._id,
				ticketId: `FFX-STR-${String(i).padStart(4, "0")}`,
				verificationToken: `tok_str_${i}`,
				tierId: isEarly ? "tier_early" : "tier_regular",
				tierName: isEarly ? "Early Bird" : "Regular",
				attendeeName: `Attendee Test ${i}`,
				attendeeEmail: `attendee.${i}@stressdomain.com`,
				attendeePhone: `+9190000${String(i).padStart(5, "0")}`,
				paymentStatus: RegistrationPaymentStatus.Paid,
				amountPaid: isEarly ? 399 : 599,
				checkedIn: isCheckedIn,
				checkedInAt: isCheckedIn ? new Date() : null,
			});
		}

		await EventRegistration.insertMany(docs);

		// Benchmark Summary Calculation Execution Time
		const startBench = performance.now();

		const allRegs = await EventRegistration.find({ eventId: event._id }).lean();
		const totalCheckedIn = allRegs.filter((r) => r.checkedIn).length;
		const totalRevenue = allRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);

		const tierBreakdown = (event.ticketTiers || []).map((t) => {
			const bookedCount = allRegs.filter((r) => r.tierId === t.tierId).length;
			return {
				tierId: t.tierId,
				name: t.name,
				bookedCount,
				isSoldOut: bookedCount >= t.totalQuantity,
			};
		});

		const summary = {
			totalRegistered: allRegs.length,
			totalCapacity: event.totalCapacity,
			totalCheckedIn,
			totalPending: Math.max(0, allRegs.length - totalCheckedIn),
			checkedInPercentage: allRegs.length > 0 ? Math.round((totalCheckedIn / allRegs.length) * 100) : 0,
			totalRevenue,
			tierBreakdown,
		};

		const durationMs = performance.now() - startBench;
		console.log(`⏱️ Summary computation for ${totalAttendees} records executed in ${durationMs.toFixed(2)} ms.`);

		if (durationMs < 1000) {
			console.log("✅ Case 1: Computation executed well under 1000ms threshold.");
			passCount++;
		} else {
			console.error(`❌ Case 1: Duration exceeded 1000ms (${durationMs.toFixed(2)} ms)`);
			failCount++;
		}

		// Verify mathematical accuracy
		// 30 early * 399 = 11,970 + 30 regular * 599 = 17,970 = 29,940
		const expectedRevenue = 30 * 399 + 30 * 599;
		if (summary.totalRegistered === 60 && summary.totalCheckedIn === 20 && summary.totalRevenue === expectedRevenue) {
			console.log(`✅ Case 2: Mathematical counts verified: totalRegistered=60, totalCheckedIn=20, totalRevenue=₹${summary.totalRevenue}.`);
			passCount++;
		} else {
			console.error(`❌ Case 2 Failed: Revenue expected ${expectedRevenue}, got ${summary.totalRevenue}`);
			failCount++;
		}

		// Verify tier sold out accuracy
		const earlyTier = summary.tierBreakdown.find((t) => t.tierId === "tier_early");
		const regularTier = summary.tierBreakdown.find((t) => t.tierId === "tier_regular");

		if (earlyTier?.isSoldOut === true && regularTier?.isSoldOut === false) {
			console.log("✅ Case 3: Early bird accurately marked isSoldOut=true (30/30), regular pass isSoldOut=false (30/100).");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Tier sold out calculation error");
			failCount++;
		}

		console.log(`\nTest 10 Summary: ${passCount} Passed, ${failCount} Failed.`);
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
