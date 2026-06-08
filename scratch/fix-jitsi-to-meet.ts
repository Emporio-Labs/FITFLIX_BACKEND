/**
 * fix-jitsi-to-meet.ts
 * 
 * Updates all ExpertAppointment records that have a Jitsi fallback link
 * (meet.jit.si) or a Cal.id placeholder ("integrations:google:meet")
 * by generating a real Google Meet link via the Google Calendar API.
 */
import { config } from "dotenv";
import connectDB from "../src/utils/db";
import ExpertAppointment from "../src/models/ExpertAppointment";
import { createGoogleMeetLink } from "../src/integrations/google/google-meet.service";

config();

async function main() {
	await connectDB();
	console.log("✅ Connected to MongoDB");

	// Find all appointments with Jitsi or placeholder links
	const badAppointments = await ExpertAppointment.find({
		$or: [
			{ meetingUrl: { $regex: /jit\.si/i } },
			{ meetingUrl: { $regex: /integrations:google/i } },
			{ meetingLink: { $regex: /jit\.si/i } },
			{ meetingLink: { $regex: /integrations:google/i } },
			{ meetingUrl: { $exists: false } },
			{ meetingUrl: null },
		],
	}).lean();

	console.log(`Found ${badAppointments.length} appointment(s) with invalid/missing meeting links`);

	for (const appt of badAppointments) {
		const startTime = appt.appointmentStart
			? new Date(appt.appointmentStart).toISOString()
			: new Date().toISOString();
		const endTime = new Date(new Date(startTime).getTime() + 60 * 60 * 1000).toISOString();

		const expertLabel = appt.expertType === "sportsScientist" ? "Sports Scientist" : "Nutritionist";

		console.log(`\n→ Appointment ${appt._id} (${expertLabel}, start: ${startTime})`);
		console.log(`  Current meetingUrl: ${appt.meetingUrl ?? "(null)"}`);

		const meetUrl = await createGoogleMeetLink({
			summary: `Fitflix ${expertLabel} Consultation`,
			startTime,
			endTime,
			timezone: "Asia/Kolkata",
		});

		if (meetUrl) {
			await ExpertAppointment.findByIdAndUpdate(appt._id, {
				$set: { meetingUrl: meetUrl, meetingLink: meetUrl },
			});
			console.log(`  ✅ Updated to: ${meetUrl}`);
		} else {
			console.log(`  ❌ Could not generate Google Meet link — skipping`);
		}
	}

	console.log("\n🏁 Done fixing appointments");
	process.exit(0);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
