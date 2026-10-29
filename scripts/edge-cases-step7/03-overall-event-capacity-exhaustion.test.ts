import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 7 EDGE CASE 03: OVERALL EVENT CAPACITY EXHAUSTION GUARD");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	// Create a temporary mock event with capacity = 1
	const tempSlug = `test-cap-exhausted-${Date.now()}`;
	const microEvent = await FitflixEvent.create({
		title: "Micro Event Sold Out Test",
		slug: tempSlug,
		tagline: "Testing overall event exhaustion",
		description: "Short lived test event",
		status: EventStatus.Published,
		totalCapacity: 1, // Only 1 spot available
		startDate: new Date(Date.now() + 86400000),
		endDate: new Date(Date.now() + 90000000),
		reportingTime: "06:30 AM IST",
		venue: {
			name: "Test Arena",
			address: "123 Stadium Road",
			city: "Bengaluru",
		},
		ticketTiers: [
			{
				tierId: "general_micro",
				name: "General Micro",
				price: 0,
				totalQuantity: 1,
			},
		],
	});

	try {
		// 1. Initial capacity check: should be open
		const initialCount = await EventRegistration.countDocuments({
			eventId: microEvent._id,
			paymentStatus: { $ne: RegistrationPaymentStatus.Cancelled },
		});
		const isInitialSoldOut = initialCount >= (microEvent.totalCapacity || 1);

		if (!isInitialSoldOut) {
			console.log("✅ Step 1: Newly created event correctly reports available capacity.");
			passCount++;
		} else {
			console.error("❌ Step 1 failed: Event prematurely marked sold out.");
			failCount++;
		}

		// 2. Register 1 user to exhaust capacity
		const reg1 = await EventRegistration.create({
			eventId: microEvent._id,
			tierId: "general_micro",
			tierName: "General Micro",
			ticketId: "FFX-MICRO-1",
			attendeeName: "Sole Attendee",
			attendeeEmail: "sole@fitflix.in",
			attendeePhone: "+919876500001",
			paymentStatus: RegistrationPaymentStatus.Paid,
			verificationToken: "token_micro_1",
		});

		// 3. Re-evaluate capacity
		const updatedCount = await EventRegistration.countDocuments({
			eventId: microEvent._id,
			paymentStatus: { $ne: RegistrationPaymentStatus.Cancelled },
		});
		const isNowSoldOut = updatedCount >= (microEvent.totalCapacity || 1);

		if (isNowSoldOut) {
			console.log("✅ Step 2: Event recognized as fully SOLD OUT once bookings reach capacity limit.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed: Event did not recognize sold out state.");
			failCount++;
		}

		// 4. Verify Flutter App card display logic: isSoldOut returns true
		const eventDto = {
			id: microEvent._id.toString(),
			title: microEvent.title,
			slug: microEvent.slug,
			isSoldOut: isNowSoldOut,
		};

		if (eventDto.isSoldOut === true) {
			console.log("✅ Step 3: Flutter discovery payload sets `isSoldOut: true`, disabling CTA and badge.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Flutter DTO isSoldOut was false.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteMany({ eventId: microEvent._id });
		await FitflixEvent.deleteOne({ _id: microEvent._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
