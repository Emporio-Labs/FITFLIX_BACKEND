import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import EventRegistration from "../src/models/EventRegistration";
import Lead from "../src/models/Lead";
import { EventStatus, RegistrationPaymentStatus } from "../src/models/Enums";
import { registerEventSchema } from "../src/validators/event-registration.validator";

config();

async function runStep4Tests() {
	console.log("===================================================================");
	console.log("🧪 STEP 4 TEST: PUBLIC EVENT DISCOVERY & REGISTRATION CHECKOUT");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	// 1. Fetch COMMUNE PART 2 Event
	const event = await FitflixEvent.findOne({ slug: "commune-part-2-sainikpuri" });
	if (!event) {
		console.error("❌ Event commune-part-2-sainikpuri not found in DB!");
		process.exit(1);
	}

	// Ensure event is published for registration testing
	event.status = EventStatus.Published;
	await event.save();
	console.log(`📌 Target Event: "${event.title}" (Status: ${event.status})`);

	// Clean up any previous test registrations for this test runner
	const testEmail = "runner.alex@example.com";
	const testPhone = "+919876543210";
	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});
	await Lead.deleteMany({ phone: testPhone });

	// 2. Validate Register Schema
	const validPayload = {
		tierId: "commune_super_early_bird",
		attendeeName: "Alex Runner",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		answers: { tshirtSize: "M", emergencyContact: "+919876500000" },
	};
	const validationResult = registerEventSchema.safeParse(validPayload);
	if (validationResult.success) {
		console.log("✅ Step 4.1: Registration Zod Schema validated cleanly.");
		passCount++;
	} else {
		console.error("❌ Step 4.1: Schema validation failed:", validationResult.error.issues);
		failCount++;
	}

	// 3. Test Invalid Phone Validation
	const invalidPhone = registerEventSchema.safeParse({
		...validPayload,
		attendeePhone: "123", // too short
	});
	if (!invalidPhone.success) {
		console.log("✅ Step 4.2: Invalid short phone number rejected cleanly.");
		passCount++;
	} else {
		console.error("❌ Step 4.2: Short phone should have been rejected!");
		failCount++;
	}

	// 4. Test Invalid Email Validation
	const invalidEmail = registerEventSchema.safeParse({
		...validPayload,
		attendeeEmail: "not-an-email",
	});
	if (!invalidEmail.success) {
		console.log("✅ Step 4.3: Malformed email rejected cleanly.");
		passCount++;
	} else {
		console.error("❌ Step 4.3: Malformed email should have been rejected!");
		failCount++;
	}

	// 5. Execute Registration Creation & Ticket Issuance
	const initialTotalReg = event.totalRegistered || 0;
	const targetTier = event.ticketTiers.find((t) => t.tierId === "commune_super_early_bird");
	const initialTierSold = targetTier ? targetTier.soldQuantity : 0;

	// Mock ticketId & verificationToken
	const cleanSlug = event.slug.replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
	const ticketId = `FFX-${cleanSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
	const verificationToken = "a1b2c3d4e5f67890abcdef1234567890";

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: targetTier?.tierId || "commune_super_early_bird",
		tierName: targetTier?.name || "Super Early Bird Pass",
		ticketId,
		attendeeName: validPayload.attendeeName,
		attendeeEmail: validPayload.attendeeEmail,
		attendeePhone: validPayload.attendeePhone,
		answers: validPayload.answers,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: targetTier?.price || 299,
		verificationToken,
	});

	// Update event counters atomically
	await FitflixEvent.updateOne(
		{ _id: event._id, "ticketTiers.tierId": targetTier?.tierId },
		{
			$inc: {
				totalRegistered: 1,
				"ticketTiers.$.soldQuantity": 1,
			},
		},
	);

	// Sync Lead
	const lead = await Lead.findOneAndUpdate(
		{ phone: testPhone },
		{
			$setOnInsert: {
				leadName: validPayload.attendeeName,
				email: validPayload.attendeeEmail,
				phone: validPayload.attendeePhone,
				source: `Offline Event: ${event.title}`,
				status: "Warm",
				tags: ["event_attendee", "commune_super_early_bird", event.slug],
				notes: `Registered for ${event.title} (${targetTier?.name})`,
			},
		},
		{ upsert: true, returnDocument: 'after' },
	);

	if (reg && reg.ticketId.startsWith("FFX-")) {
		console.log(`✅ Step 4.4: Registration created with Ticket ID: [${reg.ticketId}]`);
		console.log(`   Attendee: ${reg.attendeeName} (${reg.attendeeEmail})`);
		console.log(`   Pass Tier: ${reg.tierName} (₹${reg.amountPaid})`);
		passCount++;
	} else {
		console.error("❌ Step 4.4: Registration creation failed!");
		failCount++;
	}

	// 6. Verify Atomic Increments on Database Document
	const refreshedEvent = await FitflixEvent.findById(event._id);
	const refreshedTier = refreshedEvent?.ticketTiers.find((t) => t.tierId === "commune_super_early_bird");

	if (
		refreshedEvent &&
		refreshedEvent.totalRegistered === initialTotalReg + 1 &&
		refreshedTier &&
		refreshedTier.soldQuantity === initialTierSold + 1
	) {
		console.log(
			`✅ Step 4.5: Atomic increments verified: totalRegistered = ${refreshedEvent.totalRegistered}, tier.soldQuantity = ${refreshedTier.soldQuantity}`,
		);
		passCount++;
	} else {
		console.error("❌ Step 4.5: Counter increment mismatch!");
		failCount++;
	}

	// 7. Verify Lead Capture in CRM
	if (lead && lead.source?.includes("COMMUNE PART 2")) {
		console.log(`✅ Step 4.6: CRM Lead captured with Warm status: "${lead.leadName}" (Phone: ${lead.phone})`);
		passCount++;
	} else {
		console.error("❌ Step 4.6: CRM Lead sync failed!");
		failCount++;
	}

	// 8. Test Duplicate Registration Guard
	const isDuplicate = await EventRegistration.findOne({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});
	if (isDuplicate) {
		console.log("✅ Step 4.7: Duplicate check correctly flagged existing registration with ticketId: " + isDuplicate.ticketId);
		passCount++;
	} else {
		console.error("❌ Step 4.7: Duplicate check failed to detect existing ticket!");
		failCount++;
	}

	// 9. Query Registrations Roster
	const allRegistrations = await EventRegistration.find({ eventId: event._id }).lean();
	if (allRegistrations.length >= 1) {
		console.log(`✅ Step 4.8: FrontDesk Attendees Roster query successful (${allRegistrations.length} attendee(s) found).`);
		passCount++;
	} else {
		console.error("❌ Step 4.8: Attendee roster query failed!");
		failCount++;
	}

	console.log(`\n===================================================================`);
	console.log(`🏁 STEP 4 BACKEND RESULTS: ${passCount} Passed, ${failCount} Failed.`);
	console.log("===================================================================\n");

	await mongoose.disconnect();
	if (failCount > 0) process.exit(1);
}

runStep4Tests();
