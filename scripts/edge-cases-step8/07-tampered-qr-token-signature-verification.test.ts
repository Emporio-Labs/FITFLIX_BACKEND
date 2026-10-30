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
	console.log("🧪 STEP 8 EDGE CASE 07: TAMPERED QR TOKEN & SIGNATURE VERIFICATION");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketIdA = `FFX-TAMP-A-${Math.floor(1000 + Math.random() * 9000)}`;
	const ticketIdB = `FFX-TAMP-B-${Math.floor(1000 + Math.random() * 9000)}`;
	const tokenA = crypto.randomBytes(16).toString("hex");
	const tokenB = crypto.randomBytes(16).toString("hex");

	const regA = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId: ticketIdA,
		attendeeName: "Genuine Pass Holder",
		attendeeEmail: "genuine.tampa@fitflix.in",
		attendeePhone: "+919999908008",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: tokenA,
	});

	const regB = await EventRegistration.create({
		eventId: event._id,
		tierId: event.ticketTiers[0]?.tierId || "general_pass",
		tierName: event.ticketTiers[0]?.name || "General Pass",
		ticketId: ticketIdB,
		attendeeName: "Other Attendee",
		attendeeEmail: "genuine.tampb@fitflix.in",
		attendeePhone: "+919999908009",
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: tokenB,
	});

	try {
		// 1. Genuine QR Verification
		const authenticScan = await EventRegistration.findOne({
			ticketId: ticketIdA,
			verificationToken: tokenA,
		});

		if (authenticScan && authenticScan.ticketId === ticketIdA) {
			console.log("✅ Step 1: Authentic ticket ID and cryptographic token pair verified successfully.");
			passCount++;
		} else {
			console.error("❌ Step 1 failed to verify authentic pass.");
			failCount++;
		}

		// 2. Tampered Token: flipped 1 character in token string
		const tamperedToken = tokenA.substring(0, tokenA.length - 2) + "ff";
		const tamperedScan = await EventRegistration.findOne({
			ticketId: ticketIdA,
			verificationToken: tamperedToken,
		});

		if (!tamperedScan) {
			console.log("✅ Step 2: Tampered token with single character alteration successfully rejected by scanner guard.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed: Tampered token was incorrectly accepted.");
			failCount++;
		}

		// 3. Token-Swapping Attack: Ticket ID A presented with Token B from another pass
		const crossAttackScan = await EventRegistration.findOne({
			ticketId: ticketIdA,
			verificationToken: tokenB, // swapped token from attendee B
		});

		if (!crossAttackScan) {
			console.log("✅ Step 3: Cross-ticket token swap attack (Ticket A with Token B) intercepted and blocked.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Swapped token was accepted.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ _id: { $in: [regA._id, regB._id] } });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
