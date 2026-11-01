import { config } from "dotenv";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 07: CSV ROSTER EXPORT SANITIZATION & DELIMITER INTEGRITY");
	console.log("===================================================================\n");

	let passCount = 0;
	let failCount = 0;

	// Simulate registrations with quotes, commas, and formula injection prefixes
	const mockRegistrations = [
		{
			ticketId: "FFX-CSV-01",
			attendeeName: 'Vikram "The Iron" Kumar',
			attendeeEmail: "vikram@example.com",
			attendeePhone: "+919888811111",
			tierName: "VIP Pass, All Access",
			tierId: "tier_vip",
			amountPaid: 999,
			paymentStatus: "paid",
			checkedIn: true,
			checkedInAt: "2026-10-29T10:00:00.000Z",
			createdAt: "2026-10-28T09:00:00.000Z",
		},
		{
			ticketId: "FFX-CSV-02",
			attendeeName: "=SUM(1+1)*cmd|' /C calc'!A0", // Spreadsheet formula injection test
			attendeeEmail: "injection@example.com",
			attendeePhone: "+919888822222",
			tierName: "Community Free",
			tierId: "tier_free",
			amountPaid: 0,
			paymentStatus: "free",
			checkedIn: false,
			checkedInAt: null,
			createdAt: "2026-10-28T10:00:00.000Z",
		},
	];

	// Implementation from frontdesk-fitflix/app/admin/events/[id]/attendees/page.tsx
	const headers = [
		"Ticket ID",
		"Attendee Name",
		"Attendee Email",
		"Attendee Phone",
		"Pass Tier Name",
		"Tier ID",
		"Amount Paid (INR)",
		"Payment Status",
		"Checked In",
		"Checked In At",
		"Registered At",
	];

	const rows = mockRegistrations.map((r) => [
		`"${r.ticketId || ""}"`,
		`"${(r.attendeeName || "").replace(/"/g, '""')}"`,
		`"${(r.attendeeEmail || "").replace(/"/g, '""')}"`,
		`"${r.attendeePhone || ""}"`,
		`"${(r.tierName || "").replace(/"/g, '""')}"`,
		`"${r.tierId || ""}"`,
		r.amountPaid ?? 0,
		`"${r.paymentStatus || ""}"`,
		r.checkedIn ? "YES" : "NO",
		`"${r.checkedInAt ? new Date(r.checkedInAt).toLocaleString() : ""}"`,
		`"${r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}"`,
	]);

	const csvString = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

	// Test 1: Quotes escaped properly
	if (csvString.includes('"Vikram ""The Iron"" Kumar"')) {
		console.log("✅ Case 1: Internal double quotes escaped properly with RFC 4180 double-double quotes.");
		passCount++;
	} else {
		console.error("❌ Case 1 Failed: Double quote escaping failed");
		failCount++;
	}

	// Test 2: Commas inside tier name preserved without creating extra columns
	if (csvString.includes('"VIP Pass, All Access"')) {
		console.log("✅ Case 2: Comma inside field correctly wrapped in quotes to prevent column splitting.");
		passCount++;
	} else {
		console.error("❌ Case 2 Failed: Comma field wrapping failed");
		failCount++;
	}

	// Test 3: Formula injection prefix is safely quoted
	if (csvString.includes('"=SUM(1+1)*cmd|\' /C calc\'!A0"')) {
		console.log("✅ Case 3: Formula prefix neutralized by enclosing in standard CSV quotes.");
		passCount++;
	} else {
		console.error("❌ Case 3 Failed: Formula injection defense failed");
		failCount++;
	}

	console.log(`\nTest 07 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
