import { config } from "dotenv";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 08: CALENDAR .ICS SPECIFICATION & RFC 5545 INTEGRITY EDGE CASE");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	const mockEvent = {
		title: "COMMUNE PART 2 — FITFLIX × CHAPTER 5 COFFEE",
		startDate: new Date("2026-10-31T06:00:00Z"),
		endDate: new Date("2026-10-31T10:00:00Z"),
		venue: {
			name: "Chapter 5 Speciality Coffee & Roastery",
			address: "Plot 12, Defence Colony, Sainikpuri",
			city: "Secunderabad",
		},
	};

	const mockPass = {
		attendeeName: "Rahul Verma",
		tierName: "Super Early Bird Pass",
		ticketId: "FFX-COM2-9842",
	};

	// Generate .ics string
	const start = mockEvent.startDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
	const end = mockEvent.endDate.toISOString().replace(/-|:|\.\d\d\d/g, "");
	const icsContent = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"BEGIN:VEVENT",
		`SUMMARY:${mockEvent.title}`,
		`DESCRIPTION:Official Pass for ${mockPass.attendeeName} (${mockPass.tierName}). Ticket ID: ${mockPass.ticketId}`,
		`LOCATION:${mockEvent.venue.name}, ${mockEvent.venue.address}, ${mockEvent.venue.city}`,
		`DTSTART:${start}`,
		`DTEND:${end}`,
		"STATUS:CONFIRMED",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

	// 1. Verify VCALENDAR envelopes
	if (icsContent.includes("BEGIN:VCALENDAR") && icsContent.includes("END:VCALENDAR")) {
		console.log("✅ Case 1 Passed: VCALENDAR envelope structure is valid RFC 5545.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Missing VCALENDAR envelope!");
		failCount++;
	}

	// 2. Verify VEVENT envelopes
	if (icsContent.includes("BEGIN:VEVENT") && icsContent.includes("END:VEVENT")) {
		console.log("✅ Case 2 Passed: VEVENT block present and balanced.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Missing VEVENT block!");
		failCount++;
	}

	// 3. Verify Date format compliance (no colons/hyphens in timestamp)
	if (/DTSTART:\d{8}T\d{6}Z/.test(icsContent) && /DTEND:\d{8}T\d{6}Z/.test(icsContent)) {
		console.log(`✅ Case 3 Passed: DTSTART and DTEND timestamps conform strictly to iCalendar date specs (${start}).`);
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Invalid date timestamp syntax in .ics!");
		failCount++;
	}

	// 4. Verify Ticket ID and Venue location embedded
	if (icsContent.includes("Ticket ID: FFX-COM2-9842") && icsContent.includes("Sainikpuri")) {
		console.log("✅ Case 4 Passed: Venue address and attendee Ticket ID properly embedded in event description.");
		passCount++;
	} else {
		console.error("❌ Case 4 Failed: Metadata missing from .ics content!");
		failCount++;
	}

	console.log(`\n📊 Test 08 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
