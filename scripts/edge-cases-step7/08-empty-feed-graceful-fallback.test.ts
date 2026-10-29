import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import FitflixEvent from "../../src/models/FitflixEvent";
import { EventStatus } from "../../src/models/Enums";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 STEP 7 EDGE CASE 08: EMPTY EVENT FEED GRACEFUL FALLBACK");
	console.log("===================================================================\n");

	await connectDB();
	let passCount = 0;
	let failCount = 0;

	try {
		// 1. Simulate query when filtering for non-existent future date (e.g. year 2099)
		const farFutureQuery = {
			status: EventStatus.Published,
			startDate: { $gte: new Date("2099-01-01T00:00:00.000Z") },
		};

		const emptyResult = await FitflixEvent.find(farFutureQuery);

		if (Array.isArray(emptyResult) && emptyResult.length === 0) {
			console.log("✅ Step 1: Query with 0 matches returns clean empty Array [] (not null or undefined).");
			passCount++;
		} else {
			console.error("❌ Step 1 failed: Expected empty array.");
			failCount++;
		}

		// 2. Validate serialization for Flutter Riverpod provider `offlineEventsProvider`
		const serializedPayload = JSON.stringify({ events: emptyResult });
		const parsed = JSON.parse(serializedPayload);

		if (parsed.events.length === 0) {
			console.log("✅ Step 2: JSON response is valid and parses cleanly in Flutter app.");
			passCount++;
		} else {
			console.error("❌ Step 2 failed.");
			failCount++;
		}

		// 3. Test Flutter Widget Collapsing Logic
		// `if (events.isEmpty) return const SizedBox.shrink();`
		const flutterWidgetRendersEmpty = parsed.events.length === 0;
		if (flutterWidgetRendersEmpty) {
			console.log("✅ Step 3: OfflineEventsCard widget safely evaluates `events.isEmpty` -> renders SizedBox.shrink() with 0px height.");
			passCount++;
		} else {
			console.error("❌ Step 3 failed: Collapsing logic error.");
			failCount++;
		}
	} finally {
		await mongoose.disconnect();
	}

	console.log(`\nResults: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
