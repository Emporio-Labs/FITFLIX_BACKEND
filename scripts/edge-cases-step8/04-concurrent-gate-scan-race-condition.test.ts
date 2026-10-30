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
	console.log("🧪 STEP 8 EDGE CASE 04: CONCURRENT GATE SCAN RACE CONDITION");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketId = `FFX-RACE-${Math.floor(1000 + Math.random() * 9000)}`;
	const testEmail = "concurrency.gate.test@fitflix.in";
	const testPhone = "+919999908005";
	const token = crypto.randomBytes(16).toString("hex");

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId,
		attendeeName: "Concurrency Gate Tester",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: token,
	});

	const initialTotalCheckedIn = event.totalCheckedIn || 0;

	try {
		console.log("🚀 Simulating twin turnstiles (Gate North & Gate South) scanning at the exact same millisecond...");

		// Atomic worker function replicating EventRegistration.findOneAndUpdate({ _id, checkedIn: false })
		const attemptCheckIn = async (gateName: string) => {
			const stampTime = new Date();
			const result = await EventRegistration.findOneAndUpdate(
				{ _id: reg._id, checkedIn: false },
				{
					$set: {
						checkedIn: true,
						checkedInAt: stampTime,
						checkInNotes: `Gate: ${gateName}`,
					},
				},
				{ returnDocument: "after" },
			);

			if (result) {
				// If check-in succeeded, increment event counter
				await FitflixEvent.findByIdAndUpdate(event._id, { $inc: { totalCheckedIn: 1 } });
				return { gateName, status: "SUCCESS", checkInNotes: result.checkInNotes };
			}
			return { gateName, status: "ALREADY_CHECKED_IN", checkInNotes: null };
		};

		// Fire concurrently
		const [resA, resB] = await Promise.all([
			attemptCheckIn("Gate North"),
			attemptCheckIn("Gate South"),
		]);

		const successResults = [resA, resB].filter((r) => r.status === "SUCCESS");
		const rejectedResults = [resA, resB].filter((r) => r.status === "ALREADY_CHECKED_IN");

		if (successResults.length === 1 && rejectedResults.length === 1) {
			console.log(`✅ Step 1: Exactly ONE gate (${successResults[0].gateName}) succeeded; secondary scan correctly rejected as duplicate.`);
			passCount++;
		} else {
			console.error(`❌ Step 1 failed: Expected 1 success & 1 rejection, got ${successResults.length} successes.`);
			failCount++;
		}

		// Verify event-level counter incremented by strictly 1
		const reloadedEvent = await FitflixEvent.findById(event._id);
		const netIncrease = (reloadedEvent?.totalCheckedIn || 0) - initialTotalCheckedIn;

		if (netIncrease === 1) {
			console.log(`✅ Step 2: Event totalCheckedIn counter increased by strictly 1 (net change: +${netIncrease}).`);
			passCount++;
		} else {
			console.error(`❌ Step 2 failed: totalCheckedIn increased by ${netIncrease} instead of 1.`);
			failCount++;
		}
	} finally {
		// Rollback counter and delete registration
		await FitflixEvent.findByIdAndUpdate(event._id, { $inc: { totalCheckedIn: -1 } });
		await EventRegistration.deleteOne({ _id: reg._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
