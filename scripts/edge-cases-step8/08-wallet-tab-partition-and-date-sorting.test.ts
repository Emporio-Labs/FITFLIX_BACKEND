import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import crypto from "crypto";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 8 EDGE CASE 08: WALLET TAB PARTITION & CHRONOLOGICAL SORTING");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	// Create 4 test events with distinct IDs and dates to respect compound unique index { eventId, attendeeEmail }
	const eventNear = await FitflixEvent.create({
		title: "Fitflix Sprint - Tomorrow",
		slug: `sprint-near-${Date.now()}`,
		startDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // tomorrow
		endDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000 + 3 * 3600 * 1000),
		reportingTime: "06:30 AM IST",
		venue: { name: "City Stadium", address: "Gate 1", city: "Bangalore" },
		totalCapacity: 100,
		coverImageUrl: "https://fitflix.in/near.jpg",
		status: EventStatus.Published,
	});

	const eventFar = await FitflixEvent.create({
		title: "Fitflix Marathon - Next Month",
		slug: `marathon-far-${Date.now()}`,
		startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // in 30 days
		endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 6 * 3600 * 1000),
		reportingTime: "05:00 AM IST",
		venue: { name: "Coast Road", address: "Mile 0", city: "Mumbai" },
		totalCapacity: 500,
		coverImageUrl: "https://fitflix.in/far.jpg",
		status: EventStatus.Published,
	});

	const eventPast = await FitflixEvent.create({
		title: "Fitflix Retro Run - Yesterday",
		slug: `retro-run-${Date.now()}`,
		startDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
		endDate: new Date(Date.now() - 20 * 60 * 60 * 1000),
		reportingTime: "07:00 AM IST",
		venue: { name: "Heritage Park", address: "North Gate", city: "Delhi" },
		totalCapacity: 200,
		coverImageUrl: "https://fitflix.in/retro.jpg",
		status: EventStatus.Completed,
	});

	const eventCancelled = await FitflixEvent.create({
		title: "Fitflix Trail Hike - Cancelled",
		slug: `trail-hike-${Date.now()}`,
		startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
		endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + 4 * 3600 * 1000),
		reportingTime: "06:00 AM IST",
		venue: { name: "Pine Hills", address: "Ridge Point", city: "Pune" },
		totalCapacity: 50,
		coverImageUrl: "https://fitflix.in/trail.jpg",
		status: EventStatus.Published,
	});

	const testEmail = "wallet.partition.test@fitflix.in";
	const testPhone = "+919999908010";

	// Cleanup prior runs
	await EventRegistration.deleteMany({
		attendeeEmail: testEmail,
	});

	// 1. Pass Near (Upcoming)
	const passNear = await EventRegistration.create({
		eventId: eventNear._id,
		tierId: "gen",
		tierName: "General Runner",
		ticketId: `FFX-NEAR-${Math.floor(1000 + Math.random() * 9000)}`,
		attendeeName: "Wallet User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	// 2. Pass Far (Upcoming, later date)
	const passFar = await EventRegistration.create({
		eventId: eventFar._id,
		tierId: "gen",
		tierName: "General Runner",
		ticketId: `FFX-FAR-${Math.floor(1000 + Math.random() * 9000)}`,
		attendeeName: "Wallet User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	// 3. Pass Attended (from yesterday's event)
	const passAttended = await EventRegistration.create({
		eventId: eventPast._id,
		tierId: "gen",
		tierName: "General Runner",
		ticketId: `FFX-ATT-${Math.floor(1000 + Math.random() * 9000)}`,
		attendeeName: "Wallet User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		checkedIn: true,
		checkedInAt: new Date(Date.now() - 22 * 3600 * 1000), // yesterday
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	// 4. Pass Cancelled (from cancelled hike event)
	const passCancelled = await EventRegistration.create({
		eventId: eventCancelled._id,
		tierId: "gen",
		tierName: "General Runner",
		ticketId: `FFX-CANC-${Math.floor(1000 + Math.random() * 9000)}`,
		attendeeName: "Wallet User",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: "cancelled" as any,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	try {
		// Simulate member wallet retrieval
		const allRegistrations = await EventRegistration.find({
			$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
		}).populate("eventId").lean();

		// Filter out cancelled passes
		const validPasses = allRegistrations.filter((r) => (r.paymentStatus as string) !== "cancelled");

		// Segregate into Upcoming vs Attended tabs
		const upcomingPasses = validPasses.filter((r) => !r.checkedIn);
		const attendedPasses = validPasses.filter((r) => r.checkedIn);

		// Upcoming tab must sort nearest event first (ascending start date)
		upcomingPasses.sort((a, b) => {
			const dateA = new Date((a.eventId as any)?.startDate).getTime();
			const dateB = new Date((b.eventId as any)?.startDate).getTime();
			return dateA - dateB;
		});

		// 1. Check Upcoming Tab sorting
		if (
			upcomingPasses.length === 2 &&
			upcomingPasses[0].ticketId === passNear.ticketId &&
			upcomingPasses[1].ticketId === passFar.ticketId
		) {
			console.log("✅ Step 1: Upcoming tab correctly lists active passes sorted nearest date first (Tomorrow -> Next Month).");
			passCount++;
		} else {
			console.error("❌ Step 1 failed: Upcoming passes not correctly sorted by date.");
			failCount++;
		}

		// 2. Check Attended Tab segregation
		if (attendedPasses.length === 1 && attendedPasses[0].ticketId === passAttended.ticketId && attendedPasses[0].checkedInAt) {
			console.log(`✅ Step 2: Attended tab captures stamped pass '${passAttended.ticketId}' with entry timestamp.`);
			passCount++;
		} else {
			console.error("❌ Step 2 failed to isolate attended pass.");
			failCount++;
		}

		// 3. Check Cancelled Pass exclusion
		const isCancelledExcluded = !upcomingPasses.some((p) => p.ticketId === passCancelled.ticketId);
		if (isCancelledExcluded) {
			console.log("✅ Step 3: Cancelled passes cleanly excluded from active member wallet views.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Cancelled pass appeared in active wallet.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			_id: { $in: [passNear._id, passFar._id, passAttended._id, passCancelled._id] },
		});
		await FitflixEvent.deleteMany({
			_id: { $in: [eventNear._id, eventFar._id, eventPast._id, eventCancelled._id] },
		});
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
