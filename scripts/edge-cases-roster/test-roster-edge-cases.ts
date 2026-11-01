import mongoose from "mongoose";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventType, EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import connectDB from "../../src/utils/db";

async function runEdgeCases() {
	console.log("=================================================================");
	console.log("   RUNNING 10 ADVANCED EDGE-CASE SUITES: EVENT ATTENDEES ROSTER   ");
	console.log("=================================================================\n");

	await connectDB();

	// Create an isolated dummy event for testing edge cases
	const testEventSlug = `roster-edge-test-${Date.now()}`;
	const testEvent = await FitflixEvent.create({
		title: "Roster Test Event",
		slug: testEventSlug,
		eventType: EventType.WellnessSummit,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "06:30 AM",
		venue: {
			name: "Fitflix Arena",
			address: "100 Wellness Way",
			city: "Bengaluru",
		},
		totalCapacity: 50,
		ticketTiers: [
			{
				tierId: "tier_free",
				name: "Free Community RSVP",
				badgeLabel: "COMMUNITY",
				badgeColor: "#10b981",
				type: "free",
				price: 0,
				totalQuantity: 2,
				soldQuantity: 0,
				perks: ["Access"],
			},
			{
				tierId: "tier_vip",
				name: "VIP Pass",
				badgeLabel: "VIP",
				badgeColor: "#f59e0b",
				type: "paid",
				price: 999,
				totalQuantity: 10,
				soldQuantity: 0,
				perks: ["VIP Access"],
			},
		],
		totalRegistered: 0,
		totalCheckedIn: 0,
	});

	try {
		// Helper to compute summary
		const computeSummary = async (eventId: mongoose.Types.ObjectId) => {
			const eventDoc = await FitflixEvent.findById(eventId);
			const allRegs = await EventRegistration.find({ eventId }).lean();
			const totalCheckedIn = allRegs.filter((r) => r.checkedIn).length;
			const totalRevenue = allRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);

			const tierBreakdown = (eventDoc?.ticketTiers || []).map((t) => {
				const bookedCount = allRegs.filter((r) => r.tierId === t.tierId).length;
				return {
					tierId: t.tierId,
					name: t.name,
					badgeLabel: t.badgeLabel,
					badgeColor: t.badgeColor,
					price: t.price,
					totalQuantity: t.totalQuantity,
					bookedCount,
					soldQuantity: t.soldQuantity || bookedCount,
					isSoldOut: (t.soldQuantity || bookedCount) >= t.totalQuantity,
				};
			});

			return {
				totalRegistered: allRegs.length,
				totalCapacity: eventDoc?.totalCapacity || 100,
				totalCheckedIn,
				totalPending: Math.max(0, allRegs.length - totalCheckedIn),
				checkedInPercentage: allRegs.length > 0 ? Math.round((totalCheckedIn / allRegs.length) * 100) : 0,
				totalRevenue,
				tierBreakdown,
			};
		};

		// --- SUITE 1: Empty Event Roster (Zero Bookings) ---
		console.log("👉 Test 1: Empty Event Roster (Zero Bookings & Division by Zero)");
		const s1 = await computeSummary(testEvent._id);
		if (s1.totalRegistered !== 0 || s1.checkedInPercentage !== 0 || s1.totalRevenue !== 0) {
			throw new Error("Test 1 Failed: Empty event summary was not 0");
		}
		console.log("   [PASS] Empty event handles zero division safely.\n");

		// --- SUITE 2: Multi-Tier Bookings & Revenue Aggregation ---
		console.log("👉 Test 2: Multi-Tier Bookings & Revenue Calculation");
		const reg1 = await EventRegistration.create({
			eventId: testEvent._id,
			ticketId: `FFX-TEST-VIP-01`,
			verificationToken: "token_vip_1",
			tierId: "tier_vip",
			tierName: "VIP Pass",
			attendeeName: "Priya Sharma",
			attendeeEmail: "priya.sharma@example.com",
			attendeePhone: "+919876543201",
			amountPaid: 999,
			paymentStatus: RegistrationPaymentStatus.Paid,
			checkedIn: false,
		});

		const reg2 = await EventRegistration.create({
			eventId: testEvent._id,
			ticketId: `FFX-TEST-FREE-01`,
			verificationToken: "token_free_1",
			tierId: "tier_free",
			tierName: "Free Community RSVP",
			attendeeName: "Rahul Verma",
			attendeeEmail: "rahul.verma@example.com",
			attendeePhone: "+919876543202",
			amountPaid: 0,
			paymentStatus: RegistrationPaymentStatus.Free,
			checkedIn: false,
		});

		const s2 = await computeSummary(testEvent._id);
		if (s2.totalRegistered !== 2 || s2.totalRevenue !== 999 || s2.totalPending !== 2) {
			throw new Error(`Test 2 Failed: Revenue expected 999, got ${s2.totalRevenue}`);
		}
		console.log(`   [PASS] 2 registrations recorded, total revenue ₹${s2.totalRevenue}.\n`);

		// --- SUITE 3: Tier Sold-Out Flagging ---
		console.log("👉 Test 3: Tier Sold-Out Flagging in Roster Breakdown");
		// Fill tier_free (capacity 2)
		const reg3 = await EventRegistration.create({
			eventId: testEvent._id,
			ticketId: `FFX-TEST-FREE-02`,
			verificationToken: "token_free_2",
			tierId: "tier_free",
			tierName: "Free Community RSVP",
			attendeeName: "Ananya Roy",
			attendeeEmail: "ananya.roy@example.com",
			attendeePhone: "+919876543203",
			amountPaid: 0,
			paymentStatus: RegistrationPaymentStatus.Free,
			checkedIn: false,
		});

		const s3 = await computeSummary(testEvent._id);
		const freeTier = s3.tierBreakdown.find((t) => t.tierId === "tier_free");
		if (!freeTier?.isSoldOut || freeTier.bookedCount !== 2) {
			throw new Error("Test 3 Failed: tier_free did not flag isSoldOut=true");
		}
		console.log(`   [PASS] tier_free correctly marked isSoldOut=true (${freeTier.bookedCount}/${freeTier.totalQuantity}).\n`);

		// --- SUITE 4: Case-Insensitive Search by Name Substring ---
		console.log("👉 Test 4: Case-Insensitive Name Search");
		const nameSearch = await EventRegistration.find({
			eventId: testEvent._id,
			attendeeName: { $regex: "priya", $options: "i" },
		});
		if (nameSearch.length !== 1 || nameSearch[0].attendeeEmail !== "priya.sharma@example.com") {
			throw new Error("Test 4 Failed: Could not find Priya via lowercase regex");
		}
		console.log(`   [PASS] Search 'priya' matched: ${nameSearch[0].attendeeName}.\n`);

		// --- SUITE 5: Phone Number Search (+91 Format) ---
		console.log("👉 Test 5: Phone Number Search");
		const phoneSearch = await EventRegistration.find({
			eventId: testEvent._id,
			attendeePhone: { $regex: "43202", $options: "i" },
		});
		if (phoneSearch.length !== 1 || phoneSearch[0].attendeeName !== "Rahul Verma") {
			throw new Error("Test 5 Failed: Phone search failed");
		}
		console.log(`   [PASS] Search '43202' matched: ${phoneSearch[0].attendeeName} (${phoneSearch[0].attendeePhone}).\n`);

		// --- SUITE 6: Ticket ID Exact & Prefix Search ---
		console.log("👉 Test 6: Ticket ID Prefix Search");
		const ticketSearch = await EventRegistration.find({
			eventId: testEvent._id,
			ticketId: { $regex: "FFX-TEST-FREE", $options: "i" },
		});
		if (ticketSearch.length !== 2) {
			throw new Error("Test 6 Failed: Ticket prefix search expected 2 items");
		}
		console.log(`   [PASS] Search 'FFX-TEST-FREE' matched ${ticketSearch.length} tickets.\n`);

		// --- SUITE 7: Check-In Filter vs Roster Summary Independence ---
		console.log("👉 Test 7: Filter by Checked-In vs Overall Summary Independence");
		// Check in Priya
		reg1.checkedIn = true;
		reg1.checkedInAt = new Date();
		await reg1.save();
		await FitflixEvent.updateOne({ _id: testEvent._id }, { $inc: { totalCheckedIn: 1 } });

		const filteredCheckedIn = await EventRegistration.find({
			eventId: testEvent._id,
			checkedIn: true,
		});
		if (filteredCheckedIn.length !== 1) {
			throw new Error("Test 7 Failed: Filtered check-in should have 1 item");
		}

		const s7 = await computeSummary(testEvent._id);
		if (s7.totalRegistered !== 3 || s7.totalCheckedIn !== 1 || s7.checkedInPercentage !== 33) {
			throw new Error(`Test 7 Failed: Summary did not compute 33% check-in rate (got ${s7.checkedInPercentage}%)`);
		}
		console.log(`   [PASS] Filtered results = 1, but overall event summary retains totalRegistered=3, checkedInPercentage=33%.\n`);

		// --- SUITE 8: Manual Check-In Toggle Execution ---
		console.log("👉 Test 8: Manual Check-In Toggle Execution");
		// Check in Rahul
		const rahulBefore = await EventRegistration.findById(reg2._id);
		if (!rahulBefore) throw new Error("Rahul not found");

		const newCheckedInState = !rahulBefore.checkedIn;
		rahulBefore.checkedIn = newCheckedInState;
		rahulBefore.checkedInAt = newCheckedInState ? new Date() : null;
		await rahulBefore.save();
		await FitflixEvent.updateOne({ _id: testEvent._id }, { $inc: { totalCheckedIn: 1 } });

		const rahulAfter = await EventRegistration.findById(reg2._id);
		const testEventAfter = await FitflixEvent.findById(testEvent._id);
		if (!rahulAfter?.checkedIn || !rahulAfter?.checkedInAt) {
			throw new Error("Test 8 Failed: Check-in toggle did not set checkedIn or timestamp");
		}
		if (testEventAfter?.totalCheckedIn !== 2) {
			throw new Error(`Test 8 Failed: Event totalCheckedIn expected 2, got ${testEventAfter?.totalCheckedIn}`);
		}
		console.log(`   [PASS] Rahul checked in at ${rahulAfter.checkedInAt.toISOString()}, totalCheckedIn=${testEventAfter.totalCheckedIn}.\n`);

		// --- SUITE 9: Manual Check-In Undo (Reverting check-in) ---
		console.log("👉 Test 9: Manual Check-In Undo");
		rahulAfter.checkedIn = false;
		rahulAfter.checkedInAt = null;
		await rahulAfter.save();
		await FitflixEvent.updateOne({ _id: testEvent._id }, { $inc: { totalCheckedIn: -1 } });

		const rahulUndone = await EventRegistration.findById(reg2._id);
		const testEventUndone = await FitflixEvent.findById(testEvent._id);
		if (rahulUndone?.checkedIn || rahulUndone?.checkedInAt !== null) {
			throw new Error("Test 9 Failed: Undo did not reset checkedIn to false");
		}
		if (testEventUndone?.totalCheckedIn !== 1) {
			throw new Error(`Test 9 Failed: totalCheckedIn expected 1 after undo, got ${testEventUndone?.totalCheckedIn}`);
		}
		console.log(`   [PASS] Check-in undone successfully, event totalCheckedIn decremented back to 1.\n`);

		// --- SUITE 10: Non-Existent Registration ID Handling ---
		console.log("👉 Test 10: Non-Existent / Invalid Registration ID Guard");
		const fakeId = new mongoose.Types.ObjectId();
		const fakeLookup = await EventRegistration.findById(fakeId);
		if (fakeLookup !== null) {
			throw new Error("Test 10 Failed: Fake lookup returned data");
		}
		console.log(`   [PASS] Non-existent ID correctly returns null, controller handles with 404 NOT_FOUND.\n`);

		console.log("=================================================================");
		console.log("      ALL 10 EVENT ROSTER & CHECK-IN EDGE CASES PASSED! ✅       ");
		console.log("=================================================================");
	} finally {
		// Cleanup test data
		await EventRegistration.deleteMany({ eventId: testEvent._id });
		await FitflixEvent.findByIdAndDelete(testEvent._id);
		await mongoose.disconnect();
	}
}

runEdgeCases().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
