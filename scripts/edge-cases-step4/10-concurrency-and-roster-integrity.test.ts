import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { RegistrationPaymentStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 10: CONCURRENT REGISTRATIONS & ROSTER INTEGRITY EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event not found!");
		process.exit(1);
	}

	const initialTotalReg = event.totalRegistered || 0;
	const targetTier = event.ticketTiers.find((t: any) => t.tierId === "commune_early_bird");
	if (!targetTier) throw new Error("Tier missing");
	const initialTierSold = targetTier.soldQuantity || 0;

	// Batch of 4 unique attendees registering concurrently
	const attendees = [
		{ name: "Concurrent Runner 1", email: "conc1@fitflix.test", phone: "+919811100001" },
		{ name: "Concurrent Runner 2", email: "conc2@fitflix.test", phone: "+919811100002" },
		{ name: "Concurrent Runner 3", email: "conc3@fitflix.test", phone: "+919811100003" },
		{ name: "Concurrent Runner 4", email: "conc4@fitflix.test", phone: "+919811100004" },
	];

	const emails = attendees.map((a) => a.email);
	await EventRegistration.deleteMany({ eventId: event._id, attendeeEmail: { $in: emails } });

	try {
		console.log(`🚀 Dispatching ${attendees.length} concurrent registrations...`);

		// Concurrent creation simulation
		const results = await Promise.all(
			attendees.map(async (att, idx) => {
				const ticketId = `FFX-CONC-${1000 + idx}`;
				const reg = await EventRegistration.create({
					eventId: event._id,
					tierId: targetTier.tierId,
					tierName: targetTier.name,
					ticketId,
					attendeeName: att.name,
					attendeeEmail: att.email,
					attendeePhone: att.phone,
					paymentStatus: RegistrationPaymentStatus.Paid,
					amountPaid: targetTier.price || 499,
					verificationToken: `token_conc_${idx}`,
				});

				// Atomic counter increment
				await FitflixEvent.updateOne(
					{ _id: event._id, "ticketTiers.tierId": targetTier.tierId },
					{
						$inc: {
							totalRegistered: 1,
							"ticketTiers.$.soldQuantity": 1,
						},
					},
				);

				return reg;
			}),
		);

		// 1. Verify all 4 documents were created
		if (results.length === 4 && results.every((r) => r._id)) {
			console.log(`✅ Case 1 Passed: All 4 concurrent registrations created with unique ticket IDs.`);
			passCount++;
		} else {
			console.error("❌ Case 1 Failed: Not all registrations completed!");
			failCount++;
		}

		// 2. Verify Atomic Counter increments strictly match batch size
		const reloaded = await FitflixEvent.findById(event._id);
		const reloadedTier = reloaded?.ticketTiers.find((t: any) => t.tierId === targetTier.tierId);

		if (
			reloaded &&
			reloaded.totalRegistered === initialTotalReg + 4 &&
			reloadedTier &&
			reloadedTier.soldQuantity === initialTierSold + 4
		) {
			console.log(
				`✅ Case 2 Passed: Event counters precisely updated (+4 totalRegistered, +4 tier.soldQuantity). Zero drift.`,
			);
			passCount++;
		} else {
			console.error(
				`❌ Case 2 Failed: Counter drift detected! Expected totalRegistered=${initialTotalReg + 4}, found=${reloaded?.totalRegistered}`,
			);
			failCount++;
		}

		// 3. Test Roster Search by partial name
		const searchResults = await EventRegistration.find({
			eventId: event._id,
			attendeeName: { $regex: "Concurrent Runner", $options: "i" },
		});
		if (searchResults.length === 4) {
			console.log("✅ Case 3 Passed: Roster search query matched all 4 attendees cleanly.");
			passCount++;
		} else {
			console.error(`❌ Case 3 Failed: Roster search found ${searchResults.length} instead of 4`);
			failCount++;
		}

		// 4. Test Roster Filter by tierId
		const tierResults = await EventRegistration.find({
			eventId: event._id,
			tierId: targetTier.tierId,
		});
		if (tierResults.length >= 4) {
			console.log(`✅ Case 4 Passed: Roster filter by tierId '${targetTier.tierId}' returned ${tierResults.length} records.`);
			passCount++;
		} else {
			console.error("❌ Case 4 Failed: Tier filter returned unexpected count!");
			failCount++;
		}
	} finally {
		// Clean up test batch and restore counters
		await EventRegistration.deleteMany({ eventId: event._id, attendeeEmail: { $in: emails } });
		await FitflixEvent.updateOne(
			{ _id: event._id, "ticketTiers.tierId": targetTier.tierId },
			{
				$inc: {
					totalRegistered: -4,
					"ticketTiers.$.soldQuantity": -4,
				},
			},
		);
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 10 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
