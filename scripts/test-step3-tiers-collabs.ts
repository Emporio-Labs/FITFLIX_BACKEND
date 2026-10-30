import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";
import { ticketTierSchema, collaboratorSchema, sponsorSchema } from "../src/validators/event.validator";

config();

async function runStep3Tests() {
	console.log("===================================================================");
	console.log("🧪 STEP 3 TEST: MULTI-TIER PASSES & CO-BRANDING COLLABORATIONS");
	console.log("===================================================================\n");

	await connectDB();

	// 1. Test Ticket Tier Zod Validation
	const validTier = ticketTierSchema.safeParse({
		tierId: "super_early_bird_01",
		name: "Super Early Bird Pass",
		badgeLabel: "SUPER EARLY BIRD",
		badgeColor: "#10b981",
		type: "paid",
		price: 299,
		totalQuantity: 50,
		perks: ["Official Event Jersey", "Priority Entrance", "Shaker Bottle"],
	});

	if (validTier.success) {
		console.log("✅ Tier Validation Passed: Super Early Bird tier validated cleanly.");
	} else {
		console.error("❌ Tier Validation Failed:", validTier.error.issues);
	}

	// 2. Test Invalid Negative Price Tier
	const invalidTier = ticketTierSchema.safeParse({
		tierId: "invalid_tier",
		name: "Negative Price Pass",
		type: "paid",
		price: -150, // Negative!
		totalQuantity: 50,
	});

	if (!invalidTier.success) {
		console.log("✅ Edge Case Passed: Negative ticket price rejected by validator.");
	} else {
		console.error("❌ Negative price should have been rejected!");
	}

	// 3. Test Collaborator & Sponsor Schema
	const validCollab = collaboratorSchema.safeParse({
		name: "Chapter 5 Speciality Coffee",
		role: "Co-Host & Roastery Partner",
		logoUrl: "https://api.fitflix.in/uploads/collaborators/chapter-5.png",
		websiteUrl: "https://chapter5coffee.com",
	});

	const validSponsor = sponsorSchema.safeParse({
		name: "Red Bull",
		logoUrl: "https://api.fitflix.in/uploads/sponsors/redbull.png",
		tier: "Title Sponsor",
	});

	if (validCollab.success && validSponsor.success) {
		console.log("✅ Co-Branding & Sponsor Validations Passed cleanly.");
	} else {
		console.error("❌ Co-Branding validation failed!");
	}

	// 4. Update the COMMUNE PART 2 Event with full real tiers & collaborators
	const communeEvent = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (communeEvent) {
		communeEvent.ticketTiers = [
			{
				tierId: "commune_super_early_bird",
				name: "Super Early Bird Pass",
				badgeLabel: "SUPER EARLY BIRD",
				badgeColor: "#10b981",
				type: "paid",
				price: 299,
				creditCost: 0,
				totalQuantity: 30,
				soldQuantity: 0,
				perks: ["Official Commune Runner Jersey", "Post-Run Pour-over Coffee by Chapter 5", "Recovery Yoga Zone"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "commune_early_bird",
				name: "Early Bird Pass",
				badgeLabel: "EARLY BIRD",
				badgeColor: "#3b82f6",
				type: "paid",
				price: 499,
				creditCost: 0,
				totalQuantity: 50,
				soldQuantity: 0,
				perks: ["Commune Runner T-Shirt", "Specialty Cold Brew Voucher", "Recovery Yoga"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "commune_rsvp_free",
				name: "Fitflix Member Community Pass",
				badgeLabel: "MEMBER ACCESS",
				badgeColor: "#8b5cf6",
				type: "free",
				price: 0,
				creditCost: 0,
				totalQuantity: 70,
				soldQuantity: 0,
				perks: ["Free Entry for Fitflix Active Members", "Hydration Support"],
				maxTicketsPerUser: 1,
			},
		] as any;

		communeEvent.collaborators = [
			{
				name: "Chapter 5 Speciality Coffee",
				role: "Co-Host & Roastery Partner",
				logoUrl: "https://api.fitflix.in/uploads/collaborators/chapter-5.png",
				websiteUrl: "https://chapter5coffee.com",
			},
		] as any;

		communeEvent.sponsors = [
			{
				name: "Fitflix Nutrition",
				logoUrl: "https://api.fitflix.in/uploads/collaborators/fitflix.png",
				tier: "Title Partner",
			},
			{
				name: "Under Armour India",
				logoUrl: "https://api.fitflix.in/uploads/collaborators/under-armour.png",
				tier: "Apparel Partner",
			},
		] as any;

		await communeEvent.save();
		console.log("✅ COMMUNE PART 2 updated with 3 Pass Tiers & Chapter 5 Coffee Co-branding!");
	}

	// 5. Update Fitflix Summit Nagpur 2026 with Fitflix Summit Tiers (matching reference 1)
	const devfestEvent = await FitflixEvent.findOne({ slug: "fitflix-sunrise-marathon-2026" });
	if (devfestEvent) {
		devfestEvent.ticketTiers = [
			{
				tierId: "sunrise_all_access",
				name: "Fitflix Summit All Access Pass",
				badgeLabel: "ALL ACCESS PASS",
				badgeColor: "#10b981",
				type: "paid",
				price: 499,
				creditCost: 0,
				totalQuantity: 250,
				soldQuantity: 0,
				perks: ["Keynote & Tech Sessions", "Official Fitflix Summit Swag Kit", "Lunch & Snacks for 2 Days"],
				maxTicketsPerUser: 1,
			},
			{
				tierId: "sunrise_student_pass",
				name: "Student Super Early Bird Pass",
				badgeLabel: "STUDENT PASS",
				badgeColor: "#3b82f6",
				type: "paid",
				price: 199,
				creditCost: 0,
				totalQuantity: 150,
				soldQuantity: 0,
				perks: ["Student ID Required at Gate", "Access to Hands-on Codelabs", "Stickers & Kit"],
				maxTicketsPerUser: 1,
			},
			{
				tierId: "sunrise_speaker_vip",
				name: "Speaker & VIP Pass",
				badgeLabel: "VIP PASS",
				badgeColor: "#f59e0b",
				type: "free",
				price: 0,
				creditCost: 0,
				totalQuantity: 50,
				soldQuantity: 0,
				perks: ["VIP Lounge Access", "Speaker Networking Dinner", "Special Swag Hamper"],
				maxTicketsPerUser: 1,
			},
		] as any;

		devfestEvent.sponsors = [
			{ name: "Google Developers", logoUrl: "https://api.fitflix.in/uploads/sponsors/google.png", tier: "Title" },
			{ name: "Peerlist", logoUrl: "https://api.fitflix.in/uploads/sponsors/peerlist.png", tier: "Platform Partner" },
			{ name: "Orkes", logoUrl: "https://api.fitflix.in/uploads/sponsors/orkes.png", tier: "Cloud Partner" },
			{ name: "Stream", logoUrl: "https://api.fitflix.in/uploads/sponsors/stream.png", tier: "Gold Partner" },
		] as any;

		await devfestEvent.save();
		console.log("✅ Fitflix Summit Nagpur 2026 updated with All Access / VIP Tiers & Sponsor Strip (matching Fitflix Summit ticket photo)!");
	}

	console.log("\n🎉 Step 3 Tests Completed Successfully!");
	await mongoose.disconnect();
}

runStep3Tests().catch((err) => {
	console.error("Step 3 tests crashed:", err);
	process.exit(1);
});
