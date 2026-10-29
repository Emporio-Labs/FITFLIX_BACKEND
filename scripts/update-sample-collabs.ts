import { config } from "dotenv";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";

config();

async function updateEventsWithCollaborators() {
	console.log("Connecting to MongoDB...");
	await connectDB();

	// 1. Fitflix × Red Bull Urban Obstacle Sprint
	const redBullEvt = await FitflixEvent.findOne({ slug: "red-bull-urban-obstacle-sprint" });
	if (redBullEvt) {
		redBullEvt.collaborators = [
			{
				name: "Red Bull",
				role: "Official Energy Partner",
				logoUrl: "/events/red-bull.svg",
				websiteUrl: "https://redbull.com",
			},
		];
		redBullEvt.ticketTiers = [
			{
				tierId: "redbull_all_access",
				name: "Obstacle All-Access Pass",
				badgeLabel: "ALL ACCESS VIP",
				badgeColor: "#f59e0b",
				type: "paid",
				price: 999,
				creditCost: 0,
				totalQuantity: 50,
				soldQuantity: 0,
				perks: ["VIP Fast-Track Obstacle Wave", "Official Dri-FIT Jersey", "Unlimited Red Bull Energy Station", "Active Recovery Zone"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "redbull_super_early",
				name: "Super Early Bird Obstacle Pass",
				badgeLabel: "SUPER EARLY BIRD",
				badgeColor: "#10b981",
				type: "paid",
				price: 499,
				creditCost: 0,
				totalQuantity: 150,
				soldQuantity: 0,
				perks: ["Finisher Medal & Chip Timing", "Official Headband", "Post-Race Cold Plunge"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "redbull_general",
				name: "General Obstacle Pass",
				badgeLabel: "RUNNER PASS",
				badgeColor: "#3b82f6",
				type: "paid",
				price: 699,
				creditCost: 0,
				totalQuantity: 200,
				soldQuantity: 0,
				perks: ["Finisher Medal", "Course Hydration Support"],
				maxTicketsPerUser: 2,
			},
		];
		await redBullEvt.save();
		console.log("✅ Updated Fitflix × Red Bull Urban Obstacle Sprint with collaborators and tiers.");
	}

	// 2. COMMUNE PART 2 — FITFLIX × CHAPTER 5 COFFEE
	const communeEvt = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (communeEvt) {
		communeEvt.collaborators = [
			{
				name: "Chapter 5 Speciality Coffee",
				role: "Co-Host & Roastery Partner",
				logoUrl: "/events/chapter-5.svg",
				websiteUrl: "https://chapter5coffee.com",
			},
		];
		await communeEvt.save();
		console.log("✅ Updated Commune Part 2 with local valid logoUrl.");
	}

	console.log("🎉 All sample events updated successfully!");
	process.exit(0);
}

updateEventsWithCollaborators().catch((err) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
