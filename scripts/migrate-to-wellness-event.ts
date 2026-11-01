import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";

config();

async function migrate() {
	await connectDB();

	const oldEvent = await FitflixEvent.findOne({ slug: "devfest-nagpur-2026" });
	if (oldEvent) {
		oldEvent.title = "Fitflix Sunrise Marathon & Recovery Yoga Summit 2026";
		oldEvent.slug = "fitflix-sunrise-marathon-2026";
		oldEvent.tagline = "10K Run, Ice Bath Recovery & Sunrise Flow";
		oldEvent.description = "A premier morning endurance and wellness experience featuring a timed 10K road run, expert-guided breathwork, cold plunge therapy, and organic recovery nutrition.";
		oldEvent.eventType = EventType.MarathonRun;
		oldEvent.status = EventStatus.Published;
		oldEvent.venue = {
			name: "Kanteerava Stadium Track & Grounds",
			address: "Kasturba Road, Sampangi Rama Nagara",
			city: "Bengaluru",
			landmark: "Near Cubbon Park Gate",
			googleMapsUrl: "https://maps.google.com/?q=Kanteerava+Stadium",
		};
		oldEvent.collaborators = [
			{
				name: "ActiveX Smart Health",
				role: "Official Bio-Scan & BCA Partner",
				logoUrl: "https://api.fitflix.in/uploads/collaborators/activex.png",
				websiteUrl: "https://activex.ai",
			},
		];
		oldEvent.ticketTiers = [
			{
				tierId: "sunrise_super_early_bird",
				name: "Super Early Bird 10K Pass",
				badgeLabel: "SUPER EARLY BIRD",
				badgeColor: "#10b981",
				type: "paid",
				price: 399,
				creditCost: 0,
				totalQuantity: 50,
				soldQuantity: 0,
				perks: ["Official Fitflix Dri-FIT Running Tee", "RFID Timing Chip & Finisher Medal", "Post-Run Cold Plunge & Protein Shake"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "sunrise_general_runner",
				name: "General Marathon Pass",
				badgeLabel: "RUNNER PASS",
				badgeColor: "#3b82f6",
				type: "paid",
				price: 599,
				creditCost: 0,
				totalQuantity: 150,
				soldQuantity: 0,
				perks: ["Official Fitflix Runner T-Shirt", "Finisher Medal", "Hydration & Recovery Zone"],
				maxTicketsPerUser: 2,
			},
			{
				tierId: "sunrise_recovery_vip",
				name: "All-Inclusive VIP Recovery Pass",
				badgeLabel: "ALL ACCESS VIP",
				badgeColor: "#f59e0b",
				type: "paid",
				price: 1499,
				creditCost: 0,
				totalQuantity: 30,
				soldQuantity: 0,
				perks: ["Priority Starting Wave (Wave A)", "ActiveX Body Composition Scan & Consultation", "Reserved Cold Plunge & Sports Massage Lounge", "Fitflix Hydro Flask Bottle"],
				maxTicketsPerUser: 2,
			},
		];
		oldEvent.sponsors = [
			{
				name: "Cult.fit",
				logoUrl: "https://api.fitflix.in/uploads/sponsors/cult.png",
				tier: "Fitness Partner",
			},
			{
				name: "Under Armour India",
				logoUrl: "https://api.fitflix.in/uploads/sponsors/under-armour.png",
				tier: "Apparel Sponsor",
			},
			{
				name: "Red Bull Energy",
				logoUrl: "https://api.fitflix.in/uploads/sponsors/redbull.png",
				tier: "Official Energy Drink",
			},
		];

		await oldEvent.save();
		console.log("✅ Successfully transformed DevFest event into 'Fitflix Sunrise Marathon & Recovery Yoga Summit 2026'!");
	} else {
		console.log("Old devfest event already migrated or not found.");
	}

	await mongoose.disconnect();
}

migrate();
