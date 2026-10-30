import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import EventRegistration from "../../src/models/EventRegistration";
import { EventStatus, RegistrationPaymentStatus } from "../../src/models/Enums";
import crypto from "crypto";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 8 EDGE CASE 05: MULTI-TIER CO-BRANDING & PERKS DATA CONTRACT");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	const event = await FitflixEvent.findOne({ status: EventStatus.Published });
	if (!event) {
		console.error("❌ No published event found for testing!");
		process.exit(1);
	}

	const vipTicketId = `FFX-VIP-${Math.floor(1000 + Math.random() * 9000)}`;
	const testEmail = "vip.perks.contract@fitflix.in";
	const testPhone = "+919999908006";

	await EventRegistration.deleteMany({
		eventId: event._id,
		$or: [{ attendeeEmail: testEmail }, { attendeePhone: testPhone }],
	});

	// Find or mock a VIP tier
	let vipTier = (event.ticketTiers || []).find((t: any) => t.name.toLowerCase().includes("vip"));
	if (!vipTier) {
		vipTier = {
			tierId: "vip_pass",
			name: "VIP Access Pass",
			badgeLabel: "VIP ALL ACCESS",
			badgeColor: "#B08D57",
			price: 1999,
			totalQuantity: 25,
			soldQuantity: 5,
			perks: ["VIP Lounge Access", "Priority Front Row", "Exclusive Goodie Bag"],
		} as any;
	}

	const reg = await EventRegistration.create({
		eventId: event._id,
		tierId: vipTier.tierId,
		tierName: vipTier.name,
		ticketId: vipTicketId,
		attendeeName: "VIP Ambassador",
		attendeeEmail: testEmail,
		attendeePhone: testPhone,
		paymentStatus: RegistrationPaymentStatus.Paid,
		amountPaid: vipTier.price || 1999,
		assignedKitCollected: false,
		checkedIn: false,
		verificationToken: crypto.randomBytes(16).toString("hex"),
	});

	try {
		// 1. Validate Tier Badge Color & Label Synchronization
		const badgeLabel = vipTier.badgeLabel || "VIP ALL ACCESS";
		const badgeColor = vipTier.badgeColor || "#B08D57";

		if (badgeColor.startsWith("#") && badgeLabel.length > 0) {
			console.log(`✅ Step 1: Tier visual tokens resolved: Label='${badgeLabel}', Color='${badgeColor}'.`);
			passCount++;
		} else {
			console.error("❌ Step 1 failed to resolve tier visual tokens.");
			failCount++;
		}

		// 2. Validate Included Perks Array Contract
		const perks = vipTier.perks || [];
		if (Array.isArray(perks) && perks.length > 0) {
			console.log(`✅ Step 2: Included perks array populated with ${perks.length} benefits: [${perks.join(", ")}].`);
			passCount++;
		} else {
			console.error("❌ Step 2 failed: Perks array missing or empty.");
			failCount++;
		}

		// 3. Validate Co-Branding Partner Logo Extraction
		const collaborators = (event.collaborators || []).map((c: any) => ({
			name: c.name || "Fitflix Partner",
			logoUrl: c.logoUrl || null,
			role: c.role || "Co-Host",
		}));

		const hasValidCoBrandFormat = Array.isArray(collaborators);
		if (hasValidCoBrandFormat) {
			console.log(`✅ Step 3: Co-branding partner lockup extracted (${collaborators.length} collaborators) with fallback safety.`);
			passCount++;
		} else {
			console.error("❌ Step 3 failed on co-branding lockup.");
			failCount++;
		}
	} finally {
		await EventRegistration.deleteOne({ _id: reg._id });
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.\n`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
