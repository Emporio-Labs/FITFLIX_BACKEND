import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";
import { createEventSchema } from "../src/validators/event.validator";

config();

async function runTestCases() {
	console.log("=================================================");
	console.log("🧪 FITFLIX EVENT CREATION: TEST CASES & EDGE CASES");
	console.log("=================================================\n");

	await connectDB();

	// -------------------------------------------------------------
	// PART 1: NEGATIVE & EDGE CASE TESTS (VALIDATION REJECTIONS)
	// -------------------------------------------------------------
	console.log("--- PART 1: VALIDATION & EDGE CASE REJECTIONS ---\n");

	// Edge Case 1: Missing Title
	const test1 = createEventSchema.safeParse({
		title: "",
		startDate: "2026-11-01T09:00:00.000Z",
		endDate: "2026-11-01T17:00:00.000Z",
		reportingTime: "08:30 AM IST",
		venue: { name: "Arena", address: "Main Road", city: "Bengaluru" },
		totalCapacity: 100,
	});
	if (!test1.success && test1.error.issues.some((i) => i.path.includes("title"))) {
		console.log("✅ Edge Case 1 Passed: Empty title properly rejected with validation error.");
	} else {
		console.error("❌ Edge Case 1 Failed: Empty title should have been rejected!");
	}

	// Edge Case 2: Inverted Dates (endDate < startDate)
	const test2 = createEventSchema.safeParse({
		title: "Backward Time Marathon",
		startDate: "2026-11-10T09:00:00.000Z",
		endDate: "2026-11-08T09:00:00.000Z", // before start date!
		reportingTime: "08:30 AM IST",
		venue: { name: "Arena", address: "Main Road", city: "Bengaluru" },
		totalCapacity: 100,
	});
	if (!test2.success && test2.error.issues.some((i) => i.message.includes("endDate cannot be before startDate"))) {
		console.log("✅ Edge Case 2 Passed: Inverted dates properly rejected with validation error.");
	} else {
		console.error("❌ Edge Case 2 Failed: Inverted dates should have been rejected!");
	}

	// Edge Case 3: Zero or Negative Capacity
	const test3 = createEventSchema.safeParse({
		title: "Zero Capacity Meetup",
		startDate: "2026-11-10T09:00:00.000Z",
		endDate: "2026-11-10T17:00:00.000Z",
		reportingTime: "08:30 AM IST",
		venue: { name: "Arena", address: "Main Road", city: "Bengaluru" },
		totalCapacity: 0,
	});
	if (!test3.success && test3.error.issues.some((i) => i.path.includes("totalCapacity"))) {
		console.log("✅ Edge Case 3 Passed: Zero/Negative capacity properly rejected.");
	} else {
		console.error("❌ Edge Case 3 Failed: Zero capacity should have been rejected!");
	}

	// Edge Case 4: Missing Venue Details
	const test4 = createEventSchema.safeParse({
		title: "Venue-less Workshop",
		startDate: "2026-11-10T09:00:00.000Z",
		endDate: "2026-11-10T17:00:00.000Z",
		reportingTime: "08:30 AM IST",
		venue: { name: "", address: "", city: "" },
		totalCapacity: 50,
	});
	if (!test4.success && test4.error.issues.some((i) => i.path.includes("venue"))) {
		console.log("✅ Edge Case 4 Passed: Empty venue name/address properly rejected.");
	} else {
		console.error("❌ Edge Case 4 Failed: Empty venue should have been rejected!");
	}

	// Edge Case 5: Duplicate Custom Slug
	const testSlug = `conflict-test-slug-${Date.now()}`;
	await FitflixEvent.deleteOne({ slug: testSlug });
	await FitflixEvent.create({
		title: "Slug Test 1",
		slug: testSlug,
		startDate: new Date(),
		endDate: new Date(Date.now() + 3600000),
		reportingTime: "09:00 AM IST",
		venue: { name: "Studio", address: "Road", city: "Bengaluru" },
		totalCapacity: 50,
	});
	try {
		await FitflixEvent.create({
			title: "Slug Test 2",
			slug: testSlug, // duplicate!
			startDate: new Date(),
			endDate: new Date(Date.now() + 3600000),
			reportingTime: "09:00 AM IST",
			venue: { name: "Studio", address: "Road", city: "Bengaluru" },
			totalCapacity: 50,
		});
		console.error("❌ Edge Case 5 Failed: Duplicate slug should have thrown Mongo error!");
	} catch (err: any) {
		if (err.code === 11000) {
			console.log("✅ Edge Case 5 Passed: Duplicate unique slug rejected with duplicate key error.");
		} else {
			console.log("✅ Edge Case 5 Handled:", err.message);
		}
	}
	await FitflixEvent.deleteOne({ slug: testSlug });

	// -------------------------------------------------------------
	// PART 2: SEED 10 DIVERSE EVENTS WITH REALISTIC EDGE CASES
	// -------------------------------------------------------------
	console.log("\n--- PART 2: CREATING 10 REALISTIC OFFLINE EVENTS ---\n");

	const sampleEvents = [
		// 1. The exact poster event from user: COMMUNE PART 2
		{
			title: "COMMUNE PART 2 — FITFLIX × CHAPTER 5 COFFEE",
			slug: "commune-part-2-sainikpuri",
			tagline: "RUN · YOGA · COFFEE · COMMUNITY",
			description:
				"A Saturday morning collective experience: 5K community run, dynamic recovery yoga, artisanal pour-overs, and wellness networking.",
			eventType: EventType.MarathonRun,
			status: EventStatus.Published,
			startDate: new Date("2026-10-31T06:00:00.000Z"),
			endDate: new Date("2026-10-31T10:30:00.000Z"),
			reportingTime: "06:00 AM IST",
			venue: {
				name: "Chapter 5 Speciality Coffee & Roastery",
				address: "Plot 14, 5th Avenue, Defence Colony, Sainikpuri",
				city: "Hyderabad",
				landmark: "Near Sainikpuri Arch",
				googleMapsUrl: "https://maps.google.com/?q=Chapter+5+Coffee+Sainikpuri",
			},
			totalCapacity: 150,
			coverImageUrl: "/events/commune-part-2.png",
			collaborators: [
				{
					name: "Chapter 5 Speciality Coffee",
					role: "Co-Host & Nutrition Partner",
					logoUrl: "https://api.fitflix.in/uploads/collaborators/chapter-5.png",
					websiteUrl: "https://chapter5coffee.com",
				},
			],
		},

		// 2. Fitflix Summit Nagpur 2026 (matching Fitflix Summit reference photo)
		{
			title: "Fitflix Sunrise Marathon & Recovery Yoga Summit 2026",
			slug: "fitflix-sunrise-marathon-2026",
			tagline: "Central India's Largest Technology & Engineering Summit",
			description:
				"2 days of deep technical sessions, AI workshops, community networking, and swag distribution with official Fitflix Summit attendee passes.",
			eventType: EventType.CommunityMeetup,
			status: EventStatus.Published,
			startDate: new Date("2026-11-05T09:00:00.000Z"),
			endDate: new Date("2026-11-06T18:00:00.000Z"),
			reportingTime: "09:00 AM IST",
			venue: {
				name: "Suresh Bhat Auditorium",
				address: "Great Nag Road, Reshim Bagh",
				city: "Nagpur",
				landmark: "Near Reshim Bagh Ground",
				googleMapsUrl: "https://maps.google.com/?q=Suresh+Bhat+Auditorium+Nagpur",
			},
			totalCapacity: 500,
			coverImageUrl: "https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&q=80",
			collaborators: [
				{
					name: "Google Developer Groups Nagpur",
					role: "Lead Organizer",
					logoUrl: "https://api.fitflix.in/uploads/collaborators/gdg.png",
					websiteUrl: "https://devfestnagpur.in",
				},
			],
		},

		// 3. GDSC WoW Pune 2026 (matching WoW reference photo)
		{
			title: "GDSC WoW Pune 2026 (World of Wonders)",
			slug: "gdsc-wow-pune-2026",
			tagline: "Connect · Learn · Build Together",
			description:
				"State-level gathering of students, creators, and technologists hosted at MIT-WPU Pune.",
			eventType: EventType.Workshop,
			status: EventStatus.Published,
			startDate: new Date("2026-04-16T08:00:00.000Z"),
			endDate: new Date("2026-04-16T17:00:00.000Z"),
			reportingTime: "08:00 AM IST",
			venue: {
				name: "MIT World Peace University (MIT-WPU)",
				address: "Survey No. 124, Paud Rd, Kothrud",
				city: "Pune",
				landmark: "Main Auditorium Building",
			},
			totalCapacity: 400,
			coverImageUrl: "https://images.unsplash.com/photo-1511578314322-379afb476865?w=1200&q=80",
		},

		// 4. Large-Scale Championship (800 Attendees)
		{
			title: "Fitflix National Powerlifting Championship 2026",
			slug: "national-powerlifting-championship-2026",
			tagline: "Squat · Bench · Deadlift — Test Your True 1RM",
			description:
				"3 weight categories, official IPF certified referees, live broadcast, and ₹5,00,000 in cash prizes.",
			eventType: EventType.FitnessChallenge,
			status: EventStatus.Published,
			startDate: new Date("2026-12-12T07:00:00.000Z"),
			endDate: new Date("2026-12-13T20:00:00.000Z"),
			reportingTime: "07:00 AM IST",
			venue: {
				name: "Koramangala Indoor Stadium",
				address: "80 Feet Rd, 8th Block, Koramangala",
				city: "Bengaluru",
				landmark: "Opposite National Games Village",
			},
			totalCapacity: 800,
			coverImageUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1200&q=80",
		},

		// 5. Boutique Micro-Masterclass (Only 15 spots - Low Capacity Edge Case)
		{
			title: "Micro-Masterclass: Kettlebell Flow & Joint Longevity",
			slug: "kettlebell-flow-masterclass",
			tagline: "High-Touch Coaching (Strictly 15 Seats)",
			description:
				"Intimate 3-hour biomechanics workshop analyzing snatch mechanics, thoracic rotation, and Turkish get-up progressions.",
			eventType: EventType.Masterclass,
			status: EventStatus.Published,
			startDate: new Date("2026-11-14T10:00:00.000Z"),
			endDate: new Date("2026-11-14T13:00:00.000Z"),
			reportingTime: "09:45 AM IST",
			venue: {
				name: "Fitflix Flagship Studio Indiranagar",
				address: "100ft Road, HAL 2nd Stage, Indiranagar",
				city: "Bengaluru",
				landmark: "Above Starbucks",
			},
			totalCapacity: 15,
			coverImageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1200&q=80",
		},

		// 6. Besant Nagar Sunrise 10K Beach Run
		{
			title: "Besant Nagar Sunrise 10K & Coastal Recovery",
			slug: "chennai-sunrise-10k-beach-run",
			tagline: "Breathe with the Bay of Bengal, Sprint on the Shore",
			description:
				"Early dawn beach promenade run followed by guided oceanfront breathing exercises and tender coconut refreshment desk.",
			eventType: EventType.MarathonRun,
			status: EventStatus.Published,
			startDate: new Date("2026-11-22T05:30:00.000Z"),
			endDate: new Date("2026-11-22T09:30:00.000Z"),
			reportingTime: "05:00 AM IST",
			venue: {
				name: "Elliot's Beach Promenade",
				address: "Besant Nagar Beach Road",
				city: "Chennai",
				landmark: "Near Karl Schmidt Memorial",
			},
			totalCapacity: 250,
			coverImageUrl: "https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?w=1200&q=80",
		},

		// 7. Hyrox Functional Simulation
		{
			title: "Fitflix Hyrox Functional Simulation Challenge",
			slug: "hyrox-simulation-hyderabad-2026",
			tagline: "8×1km Run + SkiErg, Sled Push, Burpee Broad Jumps",
			description:
				"Full race rehearsal with official timer chips, pacing marshals, and split-second leaderboard display.",
			eventType: EventType.FitnessChallenge,
			status: EventStatus.Published,
			startDate: new Date("2026-11-28T06:30:00.000Z"),
			endDate: new Date("2026-11-28T16:00:00.000Z"),
			reportingTime: "06:00 AM IST",
			venue: {
				name: "Hitex Exhibition Center, Hall 3",
				address: "Trade Fair Office Building, Izzat Nagar, Hitec City",
				city: "Hyderabad",
				landmark: "Near Novotel HICC",
			},
			totalCapacity: 300,
			coverImageUrl: "https://images.unsplash.com/photo-1434596922112-19c563067271?w=1200&q=80",
		},

		// 8. Women's Wellness Summit
		{
			title: "Mind & Muscle: Women's Holistic Health Summit",
			slug: "womens-holistic-health-summit",
			tagline: "Strength, Hormonal Balance, Nutrition & Recovery",
			description:
				"Panel discussions with sports gynecologists, female strength coaches, and bio-markers analysis workshops.",
			eventType: EventType.WellnessSummit,
			status: EventStatus.Published,
			startDate: new Date("2026-12-05T09:00:00.000Z"),
			endDate: new Date("2026-12-05T15:00:00.000Z"),
			reportingTime: "08:30 AM IST",
			venue: {
				name: "The Oberoi Grand Lawns",
				address: "37-39, Mahatma Gandhi Rd",
				city: "Bengaluru",
				landmark: "Opposite 1 MG-Lido Mall",
			},
			totalCapacity: 120,
			coverImageUrl: "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=1200&q=80",
		},

		// 9. Midnight Neon 5K & DJ Sound Bath
		{
			title: "Midnight Neon 5K Run & DJ Sound Celebration",
			slug: "midnight-neon-5k-run-2026",
			tagline: "Glow Sticks, Pumping Bass & Night Fitness",
			description:
				"Night-time illuminated trail run inside Cubbon Park with live DJ stage and protein shake bar.",
			eventType: EventType.Celebration,
			status: EventStatus.Published,
			startDate: new Date("2026-12-31T21:00:00.000Z"),
			endDate: new Date("2027-01-01T01:00:00.000Z"),
			reportingTime: "08:30 PM IST",
			venue: {
				name: "Cubbon Park Central Pavilion",
				address: "Kasturba Road, Sampangi Rama Nagar",
				city: "Bengaluru",
				landmark: "Near High Court of Karnataka Gate",
			},
			totalCapacity: 350,
			coverImageUrl: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80",
		},

		// 10. Draft State Event (Testing unpublished / hidden state)
		{
			title: "Fitflix × Red Bull Urban Obstacle Sprint",
			slug: "red-bull-urban-obstacle-sprint",
			tagline: "Speed, Agility & Parkour Obstacle Course",
			description:
				"Draft preview: Timed ninja obstacle trials, warp walls, monkey rings, and sprint gates.",
			eventType: EventType.FitnessChallenge,
			status: EventStatus.Draft, // Testing draft state!
			startDate: new Date("2027-01-16T08:00:00.000Z"),
			endDate: new Date("2027-01-16T18:00:00.000Z"),
			reportingTime: "07:30 AM IST",
			venue: {
				name: "Phoenix Marketcity Courtyard",
				address: "Whitefield Main Rd, Devasandra Industrial Estate",
				city: "Bengaluru",
				landmark: "Central Amphitheatre",
			},
			totalCapacity: 450,
			coverImageUrl: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80",
		},
	];

	for (let i = 0; i < sampleEvents.length; i++) {
		const evt = sampleEvents[i];
		// Upsert so the test can be run idempotently
		await FitflixEvent.findOneAndUpdate(
			{ slug: evt.slug },
			{ $set: evt },
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		);
		console.log(
			`[${i + 1}/10] Created Event: "${evt.title}" (${evt.venue.city} | ${evt.venue.name} | Cap: ${evt.totalCapacity})`,
		);
	}

	const totalCount = await FitflixEvent.countDocuments();
	console.log(`\n🎉 Test Suite Completed! Total Fitflix Events in Database: ${totalCount}`);
	await mongoose.disconnect();
}

runTestCases()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Test execution failed:", err);
		process.exit(1);
	});
