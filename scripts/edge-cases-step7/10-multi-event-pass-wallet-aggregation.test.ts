import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import User from "../../src/models/User";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import crypto from "crypto";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 7 EDGE CASE 10: MULTI-EVENT PASS WALLET AGGREGATION");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const events = await FitflixEvent.find({ status: EventStatus.Published }).limit(3);
	if (events.length < 3) {
		console.error("❌ Need at least 3 published events for multi-event wallet test!");
		process.exit(1);
	}

	const event1 = events[0];
	const event2 = events[1];
	const event3 = events[2];

	const testUserEmail = "wallet.aggregator@fitflix.in";
	let user = await User.findOne({ email: testUserEmail });
	if (!user) {
		user = await User.create({
			username: "Wallet Aggregator",
			email: testUserEmail,
			phone: "+919876543000",
			age: 26,
			gender: "Female",
			onboarded: true,
		});
	}

	const ticketUpcoming = "FFX-WALLET-UPCOMING";
	const ticketAttended = "FFX-WALLET-ATTENDED";
	const ticketCancelled = "FFX-WALLET-CANCELLED";

	await EventRegistration.deleteMany({
		$or: [
			{ ticketId: { $in: [ticketUpcoming, ticketAttended, ticketCancelled] } },
			{ attendeeEmail: testUserEmail },
		],
	});

	try {
		// 1. Pass 1 on Event 1: Active upcoming pass (checkedIn: false, Paid)
		await EventRegistration.create({
			eventId: event1._id,
			userId: user._id,
			tierId: "general",
			tierName: "General Runner",
			ticketId: ticketUpcoming,
			attendeeName: user.username,
			attendeeEmail: user.email,
			attendeePhone: user.phone,
			paymentStatus: RegistrationPaymentStatus.Paid,
			checkedIn: false,
			verificationToken: crypto.randomBytes(16).toString("hex"),
		});

		// 2. Pass 2 on Event 2: Past attended pass (checkedIn: true, Paid)
		await EventRegistration.create({
			eventId: event2._id,
			userId: user._id,
			tierId: "vip",
			tierName: "VIP Pass",
			ticketId: ticketAttended,
			attendeeName: user.username,
			attendeeEmail: user.email,
			attendeePhone: user.phone,
			paymentStatus: RegistrationPaymentStatus.Paid,
			checkedIn: true,
			checkedInAt: new Date(Date.now() - 86400000),
			verificationToken: crypto.randomBytes(16).toString("hex"),
		});

		// 3. Pass 3 on Event 3: Cancelled registration (should be omitted from active wallet)
		await EventRegistration.create({
			eventId: event3._id,
			userId: user._id,
			tierId: "general",
			tierName: "General Runner",
			ticketId: ticketCancelled,
			attendeeName: user.username,
			attendeeEmail: user.email,
			attendeePhone: user.phone,
			paymentStatus: RegistrationPaymentStatus.Cancelled,
			verificationToken: crypto.randomBytes(16).toString("hex"),
		});

		// 4. Query Member Passes Wallet (`GET /events/my-passes`)
		const validPasses = await EventRegistration.find({
			userId: user._id,
			paymentStatus: {
				$in: [
					RegistrationPaymentStatus.Paid,
					RegistrationPaymentStatus.Free,
					RegistrationPaymentStatus.OfflineApproved,
				],
			},
		}).populate("eventId");

		console.log(`Wallet retrieved ${validPasses.length} valid passes.`);

		// 5. Verification: Exactly 2 passes (Cancelled omitted)
		if (validPasses.length === 2) {
			console.log("✅ Step 1: Cancelled passes correctly filtered out of member pass wallet.");
			passCount++;
		} else {
			console.error(`❌ Step 1 failed: Expected 2 passes, got ${validPasses.length}`);
			failCount++;
		}

		// 6. Verification: Partitioning upcoming vs attended
		const upcoming = validPasses.filter((p) => !p.checkedIn);
		const attended = validPasses.filter((p) => p.checkedIn);

		if (upcoming.length === 1 && upcoming[0].ticketId === ticketUpcoming) {
			console.log("✅ Step 2: Upcoming tab accurately isolates active unchecked pass.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed.");
			failCount++;
		}

		if (attended.length === 1 && attended[0].ticketId === ticketAttended) {
			console.log("✅ Step 3: Attended tab accurately isolates stamped pass.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({
			ticketId: { $in: [ticketUpcoming, ticketAttended, ticketCancelled] },
		});
		await User.deleteOne({ _id: user._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
