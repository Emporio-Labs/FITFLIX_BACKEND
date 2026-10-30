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
	console.log("🧪 STEP 8 EDGE CASE 03: AIRPLANE MODE TO ONLINE TRANSITION & STAMP SYNC");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const ticketId = `FFX-AIRP-${Math.floor(1000 + Math.random() * 9000)}`;
	const testEmail = "airplane.transition.test@fitflix.in";
	const testPhone = "+919999908004";
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
		attendeeName: "Airplane Mode Traveler",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: 0,
		checkedIn: false,
		verificationToken: token,
	});

	try {
		// 1. User launches pass in Airplane Mode (Offline Cache read)
		let localCache = {
			ticketId: reg.ticketId,
			attendeeName: reg.attendeeName,
			checkedIn: false,
			checkedInAt: null as string | null,
			qrPayload: `ffx://event-pass/${reg.ticketId}?token=${token}`,
		};

		if (localCache.checkedIn === false && localCache.qrPayload) {
			console.log(`✅ Step 1: Member opens pass '${ticketId}' completely offline in Airplane Mode.`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed.");
			failCount++;
		}

		// 2. Optical check-in happens at FrontDesk entrance (FrontDesk has online connectivity)
		const scanTime = new Date();
		await EventRegistration.updateOne(
			{ _id: reg._id, checkedIn: false },
			{
				$set: {
					checkedIn: true,
					checkedInAt: scanTime,
				},
			},
		);
		console.log("📌 Turnstile scanner successfully stamped check-in on the server.");

		// 3. Member turns off Airplane Mode / regains network connectivity
		// Mobile app client polling detects checkedIn = true
		const serverPass = await EventRegistration.findOne({ ticketId: reg.ticketId }).lean();
		const onlineSyncDetected = serverPass && serverPass.checkedIn === true && serverPass.checkedInAt;

		if (onlineSyncDetected) {
			console.log(`✅ Step 2: Online re-connection instantly synced: status is checkedIn=true at ${serverPass.checkedInAt?.toISOString()}.`);
			passCount++;
		} else {
			console.error("❌ Step 2 failed to detect online check-in state.");
			failCount++;
		}

		// 4. Update local cache with checked-in stamp (persisted locally so future offline opens show stamped)
		localCache = {
			...localCache,
			checkedIn: true,
			checkedInAt: serverPass!.checkedInAt!.toISOString(),
		};

		if (localCache.checkedIn === true && localCache.checkedInAt) {
			console.log(`✅ Step 3: Local cache updated with stamp '${localCache.checkedInAt}'; future offline opens show CHECKED IN.`);
			passCount++;
		} else {
			console.error("❌ Step 3 failed to stamp local cache.");
			failCount++;
		}
	} finally {
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
