import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import BcaMetric from "../src/models/BcaMetric";
import { fetchBcaRecords, upsertBcaRecordForUser, formatPhoneForActiveX } from "../src/utils/activex.service";

config();

async function main() {
	console.log("=== Testing ActiveX Integration ===");
	const apiKey = process.env.ACTIVEX_API_KEY;
	console.log("ACTIVEX_API_KEY present:", Boolean(apiKey), apiKey ? `(${apiKey.slice(0, 4)}...${apiKey.slice(-4)})` : "(empty)");

	await connectDB();
	console.log("Connected to MongoDB.");

	// Find a user with a phone number
	const users = await User.find({ phone: { $exists: true, $ne: "" } }).select("username phone onboardingStatus").limit(5);
	console.log(`Found ${users.length} users with phone numbers:`);
	for (const u of users) {
		console.log(`- ${u.username} (${u.phone}) -> ActiveX Phone format: ${formatPhoneForActiveX(u.phone)}`);
	}

	if (users.length === 0) {
		console.log("No users found to test with.");
		process.exit(0);
	}

	const testUser = users[0];
	console.log(`\nTesting fetchBcaRecords for: ${testUser.username} (${testUser.phone})...`);

	try {
		const records = await fetchBcaRecords(testUser.phone);
		console.log(`ActiveX API call successful! Received ${records.length} records.`);
		if (records.length > 0) {
			console.log("Sample record from ActiveX:", JSON.stringify(records[0], null, 2));
			console.log("\nUpserting record into database...");
			await upsertBcaRecordForUser(testUser._id as mongoose.Types.ObjectId, records[0]);
			console.log("Upsert successful!");

			const metrics = await BcaMetric.find({ userId: testUser._id }).sort({ recordedAt: -1 });
			console.log(`Total BcaMetric documents in DB for user: ${metrics.length}`);
			const updatedUser = await User.findById(testUser._id).select("onboardingStatus");
			console.log("User activeXTestCompleted status:", updatedUser?.onboardingStatus?.activeXTestCompleted);
		} else {
			console.log("No scan records found for this phone number on ActiveX (this is normal if the user hasn't scanned on the machine yet).");
		}
	} catch (err: any) {
		console.error("ActiveX Test Error:", err.message, err.code || "");
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Script failed:", err);
	process.exit(1);
});
