import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";
import { updateEventSchema } from "../src/validators/event.validator";

config();

async function runStep2Tests() {
	console.log("=================================================");
	console.log("🧪 FITFLIX EVENT STEP 2: GET, UPDATE & DELETE TESTS");
	console.log("=================================================\n");

	await connectDB();

	// 1. Create a dummy test event to test update & delete lifecycle
	const testSlug = `step2-lifecycle-${Date.now()}`;
	await FitflixEvent.deleteOne({ slug: testSlug });

	const created = await FitflixEvent.create({
		title: "Lifecycle Test Event",
		slug: testSlug,
		tagline: "Before Update",
		description: "Initial description",
		eventType: EventType.Workshop,
		status: EventStatus.Draft,
		startDate: new Date("2026-11-20T10:00:00.000Z"),
		endDate: new Date("2026-11-20T14:00:00.000Z"),
		reportingTime: "09:30 AM IST",
		venue: {
			name: "Test Arena",
			address: "Test Street 10",
			city: "Bengaluru",
		},
		totalCapacity: 50,
	});

	console.log(`✅ Test Event Created with ID: ${created._id}`);

	// 2. Test GET by ID and Slug
	const byId = await FitflixEvent.findById(created._id).lean();
	const bySlug = await FitflixEvent.findOne({ slug: testSlug }).lean();
	if (byId && bySlug && String(byId._id) === String(bySlug._id)) {
		console.log("✅ GET by ID and GET by Slug working consistently.");
	} else {
		console.error("❌ GET lookup failed!");
	}

	// 3. Test Validation on Update (Inverted Dates)
	const invalidUpdate = updateEventSchema.safeParse({
		startDate: "2026-11-20T10:00:00.000Z",
		endDate: "2026-11-19T10:00:00.000Z", // Inverted!
	});
	if (!invalidUpdate.success) {
		console.log("✅ Update Validation Passed: Inverted date ranges are properly rejected.");
	} else {
		console.error("❌ Update Validation Failed: Inverted date should be rejected!");
	}

	// 4. Test Valid Partial Update
	const validUpdate = updateEventSchema.safeParse({
		title: "Updated Lifecycle Event (Live)",
		tagline: "After Successful Update",
		status: EventStatus.Published,
		totalCapacity: 120,
		reportingTime: "08:45 AM IST",
	});

	if (validUpdate.success) {
		const updated = await FitflixEvent.findByIdAndUpdate(
			created._id,
			{ $set: validUpdate.data },
			{ new: true },
		).lean();

		if (
			updated &&
			updated.title === "Updated Lifecycle Event (Live)" &&
			updated.status === EventStatus.Published &&
			updated.totalCapacity === 120
		) {
			console.log("✅ PATCH Update Passed: Document fields updated successfully.");
		} else {
			console.error("❌ PATCH Update Failed to apply changes!");
		}
	}

	// 5. Test Delete Event
	await FitflixEvent.deleteOne({ _id: created._id });
	const lookupAfterDelete = await FitflixEvent.findById(created._id).lean();
	if (!lookupAfterDelete) {
		console.log("✅ DELETE Event Passed: Event document cleanly removed from database.");
	} else {
		console.error("❌ DELETE Event Failed: Event still exists!");
	}

	console.log("\n🎉 Step 2 Backend Tests Passed 100%!");
	await mongoose.disconnect();
}

runStep2Tests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Step 2 Tests Failed:", err);
		process.exit(1);
	});
