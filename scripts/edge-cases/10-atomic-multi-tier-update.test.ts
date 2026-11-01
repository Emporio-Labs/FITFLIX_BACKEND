import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 10: ATOMIC MULTI-TIER & SPONSOR DB PERSISTENCE EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	// 1. Fetch target event
	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Target event commune-part-2-sainikpuri not found in DB!");
		process.exit(1);
	}

	console.log(`📌 Found target event: "${event.title}" (_id: ${event._id})`);

	// Snapshot original state
	const originalTiers = JSON.parse(JSON.stringify(event.ticketTiers || []));
	const originalSponsors = JSON.parse(JSON.stringify(event.sponsors || []));
	const originalVenue = {
		name: event.venue.name,
		address: event.venue.address,
		city: event.venue.city,
	};

	console.log(`   Initial Tiers Count: ${originalTiers.length}`);
	console.log(`   Initial Venue: ${originalVenue.name}, ${originalVenue.city}`);

	try {
		// 2. Perform Atomic Multi-Tier Modification & Sponsor Injection
		const modifiedTiers = [
			...originalTiers.map((tier: any) => {
				if (tier.tierId === "commune_super_early_bird") {
					return {
						...tier,
						price: 349, // modified price
						perks: [...tier.perks, "VIP Priority Lane"], // appended perk
					};
				}
				return tier;
			}),
			{
				tierId: "commune_flash_sale",
				name: "Flash 24h Pass",
				badgeLabel: "FLASH SALE",
				badgeColor: "#ec4899",
				type: "paid",
				price: 199,
				creditCost: 0,
				totalQuantity: 20,
				soldQuantity: 0,
				perks: ["Limited Edition Commune Wristband"],
				maxTicketsPerUser: 1,
			},
		];

		const modifiedSponsors = [
			...originalSponsors,
			{
				name: "Decathlon Sports India",
				logoUrl: "https://api.fitflix.in/uploads/sponsors/decathlon.png",
				tier: "Official Gear Partner",
			},
		];

		event.ticketTiers = modifiedTiers as any;
		event.sponsors = modifiedSponsors as any;

		await event.save();
		console.log("💾 Atomically saved multi-tier update to MongoDB.");

		// 3. Re-fetch fresh from DB to verify persistence
		const reloaded = await FitflixEvent.findById(event._id);
		if (!reloaded) throw new Error("Could not reload event from DB");

		// Assertion 1: Tier count increased by 1
		if (reloaded.ticketTiers.length === originalTiers.length + 1) {
			console.log(`✅ Case 1 Passed: Tier count accurately updated from ${originalTiers.length} to ${reloaded.ticketTiers.length}.`);
			passCount++;
		} else {
			console.error(`❌ Case 1 Failed: Expected ${originalTiers.length + 1} tiers, found ${reloaded.ticketTiers.length}`);
			failCount++;
		}

		// Assertion 2: Modified tier price & perks persisted
		const updatedSuperTier = reloaded.ticketTiers.find((t: any) => t.tierId === "commune_super_early_bird");
		if (updatedSuperTier && updatedSuperTier.price === 349 && updatedSuperTier.perks.includes("VIP Priority Lane")) {
			console.log("✅ Case 2 Passed: Super Early Bird price updated to 349 & perks persisted.");
			passCount++;
		} else {
			console.error("❌ Case 2 Failed: Tier modification did not persist properly!", updatedSuperTier);
			failCount++;
		}

		// Assertion 3: Newly added Flash tier persisted
		const flashTier = reloaded.ticketTiers.find((t: any) => t.tierId === "commune_flash_sale");
		if (flashTier && flashTier.price === 199 && flashTier.badgeColor === "#ec4899") {
			console.log("✅ Case 3 Passed: Flash Sale Tier with badgeColor #ec4899 cleanly created.");
			passCount++;
		} else {
			console.error("❌ Case 3 Failed: Flash tier not found or corrupted!");
			failCount++;
		}

		// Assertion 4: Sponsor array persisted
		const decathlonSponsor = reloaded.sponsors.find((s: any) => s.name === "Decathlon Sports India");
		if (decathlonSponsor && decathlonSponsor.tier === "Official Gear Partner") {
			console.log("✅ Case 4 Passed: Co-branding sponsor Decathlon persisted.");
			passCount++;
		} else {
			console.error("❌ Case 4 Failed: Sponsor not persisted!");
			failCount++;
		}

		// Assertion 5: Venue and other root properties remained 100% UNTOUCHED
		if (
			reloaded.venue.name === originalVenue.name &&
			reloaded.venue.address === originalVenue.address &&
			reloaded.venue.city === originalVenue.city
		) {
			console.log("✅ Case 5 Passed: Venue data perfectly intact with ZERO corruption or overwrites.");
			passCount++;
		} else {
			console.error("❌ Case 5 Failed: Venue data was corrupted during tier update!");
			failCount++;
		}
	} finally {
		// 4. Clean rollback to original state
		event.ticketTiers = originalTiers as any;
		event.sponsors = originalSponsors as any;
		await event.save();
		console.log("🔄 Restored original tiers and sponsors snapshot in DB.");
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 10 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
