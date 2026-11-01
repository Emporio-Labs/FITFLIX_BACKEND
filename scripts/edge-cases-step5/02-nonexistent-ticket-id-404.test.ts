import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../../src/utils/db";
import EventRegistration from "../../src/models/EventRegistration";

config();

async function run() {
	console.log("===================================================================");
	console.log("🧪 TEST 02: NONEXISTENT TICKET ID 404 NOT_FOUND EDGE CASE");
	console.log("===================================================================\n");

	await connectDB();

	let passCount = 0;
	let failCount = 0;

	const testCases = [
		"FFX-FAKE-0000",
		"RANDOM_STRING_123",
		"FFX-EXPIRED-9999",
	];

	try {
		for (const fakeId of testCases) {
			const found = await EventRegistration.findOne({ ticketId: fakeId.toUpperCase() });
			if (!found) {
				console.log(`✅ Case Passed: Nonexistent ticket '${fakeId}' correctly returned null (triggers 404 NOT_FOUND).`);
				passCount++;
			} else {
				console.error(`❌ Case Failed: Found unexpected document for '${fakeId}'!`);
				failCount++;
			}
		}
	} finally {
		await mongoose.disconnect();
	}

	console.log(`\n📊 Test 02 Summary: ${passCount} Passed, ${failCount} Failed.`);
	if (failCount > 0) process.exit(1);
}

run();
