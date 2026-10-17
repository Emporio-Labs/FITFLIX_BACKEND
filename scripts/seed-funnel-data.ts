import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import Location from "../src/models/Location";
import BehaviourEvent from "../src/models/BehaviourEvent";

async function seedFunnel() {
	await connectDB();

	const branch = await Location.findOne({ code: "sainikpuri" });
	if (!branch) {
		console.error("Sainikpuri branch not found!");
		process.exit(1);
	}

	const branchId = branch._id;
	console.log(`Seeding funnel events for branch: ${branch.name} (${branchId.toString()})`);

	// Clean up previous test events for this branch
	await BehaviourEvent.deleteMany({ homeLocationId: branchId });

	const now = new Date();
	const eventsToInsert = [];

	// -------------------------------------------------------------
	// 1. Sign-up Funnel (FX-22.2)
	// 100 plan views -> 65 callback requests -> 40 signup starts -> 28 signup completes -> 20 membership active
	// -------------------------------------------------------------
	const totalSignupProspects = 100;
	const signupUserIds = Array.from({ length: totalSignupProspects }, () => new mongoose.Types.ObjectId());

	for (let i = 0; i < totalSignupProspects; i++) {
		const userId = signupUserIds[i];
		// Random time within the last 7 days (October 2026)
		const baseTime = new Date(now.getTime() - (i % 7) * 24 * 3600 * 1000 - Math.random() * 3600000);

		// Step 1: All 100 view a plan
		eventsToInsert.push({
			userId,
			homeLocationId: branchId,
			event: "plan_view",
			params: { planName: "Pro Annual", price: 24500 },
			occurredAt: baseTime,
			sessionId: `sess_su_${i}`,
		});

		// Step 2: 65 request a callback
		if (i < 65) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "callback_requested",
				params: { preferredTime: "evening" },
				occurredAt: new Date(baseTime.getTime() + 15 * 60 * 1000),
				sessionId: `sess_su_${i}`,
			});
		}

		// Step 3: 40 start sign-up
		if (i < 40) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "signup_start",
				params: { step: 1 },
				occurredAt: new Date(baseTime.getTime() + 60 * 60 * 1000),
				sessionId: `sess_su_${i}`,
			});
		}

		// Step 4: 28 finish sign-up
		if (i < 28) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "signup_complete",
				params: { method: "phone" },
				occurredAt: new Date(baseTime.getTime() + 75 * 60 * 1000),
				sessionId: `sess_su_${i}`,
			});
		}

		// Step 5: 20 activate membership
		if (i < 20) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "membership_active",
				params: { planId: "annual_pro" },
				occurredAt: new Date(baseTime.getTime() + 90 * 60 * 1000),
				sessionId: `sess_su_${i}`,
			});
		}
	}

	// -------------------------------------------------------------
	// 2. Class Booking Funnel (FX-22.3)
	// 80 class views -> 48 book taps -> 32 booking confirmed
	// -------------------------------------------------------------
	const totalBookingProspects = 80;
	const bookingUserIds = Array.from({ length: totalBookingProspects }, () => new mongoose.Types.ObjectId());

	for (let i = 0; i < totalBookingProspects; i++) {
		const userId = bookingUserIds[i];
		const baseTime = new Date(now.getTime() - (i % 5) * 24 * 3600 * 1000 - Math.random() * 3600000);

		// Step 1: 80 view class catalog item
		eventsToInsert.push({
			userId,
			homeLocationId: branchId,
			event: "catalog_item_view",
			params: { type: "class", id: "class_hiit_protocol", title: "HIIT Protocol" },
			occurredAt: baseTime,
			sessionId: `sess_bk_${i}`,
		});

		// Step 2: 48 tap book
		if (i < 48) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "book_tap",
				params: { classId: "class_hiit_protocol" },
				occurredAt: new Date(baseTime.getTime() + 10 * 60 * 1000),
				sessionId: `sess_bk_${i}`,
			});
		}

		// Step 3: 32 confirm booking
		if (i < 32) {
			eventsToInsert.push({
				userId,
				homeLocationId: branchId,
				event: "booking_confirmed",
				params: { classId: "class_hiit_protocol", slot: "15:00" },
				occurredAt: new Date(baseTime.getTime() + 12 * 60 * 1000),
				sessionId: `sess_bk_${i}`,
			});
		}
	}

	console.log(`Inserting ${eventsToInsert.length} behavioural funnel events...`);
	await BehaviourEvent.insertMany(eventsToInsert);

	console.log("✅ Successfully seeded realistic Funnel Analytics test data for Sainikpuri!");
	console.log("   Sign-up Journey: 100 viewed -> 65 callback -> 40 signup started -> 28 signup finished -> 20 membership active (20% overall conversion)");
	console.log("   Class Booking: 80 viewed -> 48 book tap -> 32 confirmed (40% overall conversion)");
	process.exit(0);
}

seedFunnel().catch((err) => {
	console.error("Funnel seed failed:", err);
	process.exit(1);
});
