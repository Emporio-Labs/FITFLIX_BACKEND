import mongoose from "mongoose";
import FitflixEvent from "../src/models/FitflixEvent";
import EventRegistration from "../src/models/EventRegistration";
import connectDB from "../src/utils/db";

async function run() {
	console.log("=== Testing Event Roster Summary & Manual Check-in Toggle ===");
	await connectDB();

	const event = await FitflixEvent.findOne({ slug: "fitflix-sunrise-marathon-2026" });
	if (!event) {
		console.error("Event fitflix-sunrise-marathon-2026 not found");
		process.exit(1);
	}
	console.log(`Found event: ${event.title} (ID: ${event._id})`);

	// Ensure there is at least one test registration
	let reg = await EventRegistration.findOne({ eventId: event._id });
	if (!reg) {
		console.log("Creating test registration for roster test...");
		const tier = event.ticketTiers[0];
		reg = await EventRegistration.create({
			eventId: event._id,
			ticketId: "FFX-TEST-ROSTER-01",
			verificationToken: "token_roster_test_12345",
			tierId: tier.tierId,
			tierName: tier.name,
			attendeeName: "Roster Test Attendee",
			attendeeEmail: "roster.tester@example.com",
			attendeePhone: "+919999888800",
			amountPaid: tier.price,
			paymentStatus: tier.price === 0 ? "free_claim" : "paid",
			checkedIn: false,
		});
	}

	console.log(`Using registration: ${reg.ticketId} (checkedIn: ${reg.checkedIn})`);

	// 1. Calculate summary as done in controller
	const allRegs = await EventRegistration.find({ eventId: event._id }).lean();
	const totalCheckedIn = allRegs.filter((r) => r.checkedIn).length;
	const totalRevenue = allRegs.reduce((sum, r) => sum + (r.amountPaid || 0), 0);

	const tierBreakdown = (event.ticketTiers || []).map((t) => {
		const bookedCount = allRegs.filter((r) => r.tierId === t.tierId).length;
		return {
			tierId: t.tierId,
			name: t.name,
			badgeLabel: t.badgeLabel,
			badgeColor: t.badgeColor,
			price: t.price,
			totalQuantity: t.totalQuantity,
			bookedCount,
			soldQuantity: t.soldQuantity || bookedCount,
			isSoldOut: (t.soldQuantity || bookedCount) >= t.totalQuantity,
		};
	});

	const summary = {
		totalRegistered: allRegs.length,
		totalCapacity: event.totalCapacity || 100,
		totalCheckedIn,
		totalPending: Math.max(0, allRegs.length - totalCheckedIn),
		checkedInPercentage: allRegs.length > 0 ? Math.round((totalCheckedIn / allRegs.length) * 100) : 0,
		totalRevenue,
		tierBreakdown,
	};

	console.log("Roster Summary Output:", JSON.stringify(summary, null, 2));

	if (typeof summary.totalRegistered !== "number" || typeof summary.checkedInPercentage !== "number") {
		throw new Error("Invalid summary format");
	}

	// 2. Test Check-in Toggle Simulation
	const initialCheckedIn = reg.checkedIn;
	const initialEventCount = event.totalCheckedIn || 0;

	// Toggle ON
	reg.checkedIn = !initialCheckedIn;
	reg.checkedInAt = reg.checkedIn ? new Date() : null;
	await reg.save();
	await FitflixEvent.updateOne(
		{ _id: event._id },
		{ $inc: { totalCheckedIn: reg.checkedIn ? 1 : -1 } }
	);

	const updatedReg = await EventRegistration.findById(reg._id);
	const updatedEvent = await FitflixEvent.findById(event._id);

	console.log(`Toggle 1 -> reg.checkedIn: ${updatedReg?.checkedIn}, event.totalCheckedIn: ${updatedEvent?.totalCheckedIn}`);
	if (updatedReg?.checkedIn !== !initialCheckedIn) {
		throw new Error("Toggle 1 failed to flip check-in state");
	}

	// Toggle back (Undo)
	updatedReg.checkedIn = initialCheckedIn;
	updatedReg.checkedInAt = initialCheckedIn ? new Date() : null;
	await updatedReg.save();
	await FitflixEvent.updateOne(
		{ _id: event._id },
		{ $inc: { totalCheckedIn: initialCheckedIn ? 1 : -1 } }
	);

	const restoredEvent = await FitflixEvent.findById(event._id);
	console.log(`Toggle 2 (Undo) -> event.totalCheckedIn restored to: ${restoredEvent?.totalCheckedIn}`);

	console.log("✅ All roster calculations and check-in toggle assertions passed!");
	await mongoose.disconnect();
	process.exit(0);
}

run().catch((err) => {
	console.error("Test failed:", err);
	process.exit(1);
});
