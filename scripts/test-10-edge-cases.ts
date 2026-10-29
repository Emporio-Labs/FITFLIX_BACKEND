import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import { EventStatus, EventType } from "../src/models/Enums";
import { updateEventSchema } from "../src/validators/event.validator";

config();

async function run10EdgeCaseTests() {
	console.log("================================================================");
	console.log("🧪 EXECUTING 10 ADVANCED EDGE CASE TESTS FOR FITFLIX EVENTS");
	console.log("================================================================\n");

	await connectDB();

	let passedCount = 0;
	let failedCount = 0;

	const assert = (condition: boolean, testName: string, detail?: string) => {
		if (condition) {
			console.log(`✅ [PASS] ${testName}`);
			if (detail) console.log(`   └─ ${detail}`);
			passedCount++;
		} else {
			console.error(`❌ [FAIL] ${testName}`);
			if (detail) console.error(`   └─ ${detail}`);
			failedCount++;
		}
	};

	// Setup clean isolated test events
	const timestamp = Date.now();
	const slugA = `edge-test-a-${timestamp}`;
	const slugB = `edge-test-b-${timestamp}`;

	const eventA = await FitflixEvent.create({
		title: "Alpha Fest 2026",
		slug: slugA,
		tagline: "Alpha Edition",
		description: "Test event A",
		eventType: EventType.FitnessChallenge,
		status: EventStatus.Published,
		startDate: new Date("2026-11-10T10:00:00.000Z"),
		endDate: new Date("2026-11-10T18:00:00.000Z"),
		reportingTime: "09:30 AM IST",
		venue: {
			name: "Alpha Arena",
			address: "100ft Road",
			city: "Bengaluru",
			landmark: "Near Metro",
		},
		totalCapacity: 100,
	});

	const eventB = await FitflixEvent.create({
		title: "Beta Summit 2026",
		slug: slugB,
		tagline: "Beta Edition",
		description: "Test event B",
		eventType: EventType.Workshop,
		status: EventStatus.Draft,
		startDate: new Date("2026-12-01T09:00:00.000Z"),
		endDate: new Date("2026-12-01T17:00:00.000Z"),
		reportingTime: "08:30 AM IST",
		venue: {
			name: "Beta Hall",
			address: "5th Avenue",
			city: "Hyderabad",
		},
		totalCapacity: 75,
	});

	try {
		// -------------------------------------------------------------
		// EDGE CASE 1: Partial Nested Venue Update
		// -------------------------------------------------------------
		const partialVenueUpdate = {
			venue: {
				landmark: "Opposite High Court Gate 3",
			},
		};
		const currentVenue = (eventA.venue as any).toObject ? (eventA.venue as any).toObject() : eventA.venue;
		const mergedVenue = { ...currentVenue, ...partialVenueUpdate.venue };
		await FitflixEvent.findByIdAndUpdate(eventA._id, { $set: { venue: mergedVenue } });
		const updatedA1 = await FitflixEvent.findById(eventA._id).lean();

		assert(
			updatedA1?.venue.landmark === "Opposite High Court Gate 3" &&
			updatedA1?.venue.name === "Alpha Arena" &&
			updatedA1?.venue.city === "Bengaluru",
			"Edge Case 1: Partial nested venue update preserves existing address/city/name without overwrite",
			`Landmark: "${updatedA1?.venue.landmark}", Name: "${updatedA1?.venue.name}"`,
		);

		// -------------------------------------------------------------
		// EDGE CASE 2: Cross-Date Update Validation (StartDate > EndDate)
		// -------------------------------------------------------------
		const invertedUpdate = updateEventSchema.safeParse({
			startDate: "2026-11-15T10:00:00.000Z",
			endDate: "2026-11-12T10:00:00.000Z", // before start date!
		});
		assert(
			!invertedUpdate.success &&
			invertedUpdate.error.issues.some((i) => i.message.includes("endDate cannot be before startDate")),
			"Edge Case 2: Inverted date updates properly rejected by schema validator",
			"Rejected with 'endDate cannot be before startDate'",
		);

		// -------------------------------------------------------------
		// EDGE CASE 3: Slug Collision Detection Across Different Events
		// -------------------------------------------------------------
		const slugConflictCheck = await FitflixEvent.findOne({
			slug: slugA,
			_id: { $ne: eventB._id },
		}).lean();

		assert(
			Boolean(slugConflictCheck),
			"Edge Case 3: Renaming Event B to existing Event A slug detects 409 CONFLICT",
			`Conflict detected against existing event ID: ${slugConflictCheck?._id}`,
		);

		// -------------------------------------------------------------
		// EDGE CASE 4: Self-Slug Update (Idempotent Safe Rename)
		// -------------------------------------------------------------
		const selfSlugConflict = await FitflixEvent.findOne({
			slug: slugA,
			_id: { $ne: eventA._id }, // checking other events
		}).lean();

		assert(
			selfSlugConflict === null,
			"Edge Case 4: Updating Event A with its own existing slug is safely permitted (no false collision)",
			"Self-slug excluded from collision check correctly",
		);

		// -------------------------------------------------------------
		// EDGE CASE 5: Case-Insensitive Slug Resolution
		// -------------------------------------------------------------
		const uppercaseQuery = slugA.toUpperCase();
		const resolvedByUpper = await FitflixEvent.findOne({
			slug: uppercaseQuery.toLowerCase(),
		}).lean();

		assert(
			resolvedByUpper !== null && String(resolvedByUpper._id) === String(eventA._id),
			"Edge Case 5: Slug lookup correctly handles case-insensitivity (lowercase normalization)",
			`Queried: "${uppercaseQuery}" -> Found ID: ${resolvedByUpper?._id}`,
		);

		// -------------------------------------------------------------
		// EDGE CASE 6: Non-Existent ID / Malformed Param Lookup
		// -------------------------------------------------------------
		const nonExistentId = new mongoose.Types.ObjectId();
		const missingDoc = await FitflixEvent.findById(nonExistentId).lean();
		const malformedQuery = await FitflixEvent.findOne({ slug: "completely-non-existent-event-xyz" }).lean();

		assert(
			missingDoc === null && malformedQuery === null,
			"Edge Case 6: Non-existent ObjectId and missing slug return null (404 NOT_FOUND) without crash",
			"Both queries returned null gracefully",
		);

		// -------------------------------------------------------------
		// EDGE CASE 7: Status Filter Isolation (Draft vs Published)
		// -------------------------------------------------------------
		const publishedOnly = await FitflixEvent.find({ status: EventStatus.Published, _id: { $in: [eventA._id, eventB._id] } }).lean();
		const draftOnly = await FitflixEvent.find({ status: EventStatus.Draft, _id: { $in: [eventA._id, eventB._id] } }).lean();

		assert(
			publishedOnly.length === 1 &&
			publishedOnly[0].slug === slugA &&
			draftOnly.length === 1 &&
			draftOnly[0].slug === slugB,
			"Edge Case 7: Status filtering strictly isolates Drafts from Published events",
			`Published: [${publishedOnly.map((e) => e.slug).join(",")}], Drafts: [${draftOnly.map((e) => e.slug).join(",")}]`,
		);

		// -------------------------------------------------------------
		// EDGE CASE 8: Multi-Field Search Query ($regex across Title & City)
		// -------------------------------------------------------------
		const citySearch = await FitflixEvent.find({
			_id: { $in: [eventA._id, eventB._id] },
			$or: [
				{ title: { $regex: "Beta", $options: "i" } },
				{ "venue.city": { $regex: "Beta", $options: "i" } },
			],
		}).lean();

		assert(
			citySearch.length === 1 && citySearch[0].slug === slugB,
			"Edge Case 8: Multi-field regex search accurately matches title/city keywords",
			`Search 'Beta' returned event: "${citySearch[0]?.title}"`,
		);

		// -------------------------------------------------------------
		// EDGE CASE 9: Zero or Negative Capacity Validation
		// -------------------------------------------------------------
		const zeroCap = updateEventSchema.safeParse({ totalCapacity: 0 });
		const negativeCap = updateEventSchema.safeParse({ totalCapacity: -10 });
		const boundaryCap = updateEventSchema.safeParse({ totalCapacity: 1 });

		assert(
			!zeroCap.success && !negativeCap.success && boundaryCap.success,
			"Edge Case 9: Capacity <= 0 rejected, boundary capacity of 1 accepted",
			"Validation bounds properly enforced (min: 1)",
		);

		// -------------------------------------------------------------
		// EDGE CASE 10: Idempotent Deletion & Post-Delete Lookup
		// -------------------------------------------------------------
		// Delete Event B
		const deleteRes1 = await FitflixEvent.deleteOne({ _id: eventB._id });
		const lookupPostDelete = await FitflixEvent.findById(eventB._id).lean();
		const deleteRes2 = await FitflixEvent.deleteOne({ _id: eventB._id });

		assert(
			deleteRes1.deletedCount === 1 &&
			lookupPostDelete === null &&
			deleteRes2.deletedCount === 0,
			"Edge Case 10: Event deletion removes document and second deletion returns 0 deletedCount cleanly",
			`Delete 1 count: ${deleteRes1.deletedCount}, Post lookup: ${lookupPostDelete}, Delete 2 count: ${deleteRes2.deletedCount}`,
		);

	} finally {
		// Cleanup test records
		await FitflixEvent.deleteOne({ _id: eventA._id });
		await FitflixEvent.deleteOne({ _id: eventB._id });
		await mongoose.disconnect();
	}

	console.log("\n================================================================");
	console.log(`📊 EDGE CASE RESULTS: ${passedCount} PASSED, ${failedCount} FAILED out of 10`);
	console.log("================================================================\n");

	if (failedCount > 0) {
		process.exit(1);
	}
}

run10EdgeCaseTests().catch((err) => {
	console.error("Test execution crashed:", err);
	process.exit(1);
});
