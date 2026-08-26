import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import BcaMetric from "../src/models/BcaMetric";
import { formatPhoneForActiveX, mapActiveXRecordToBcaMetric, upsertBcaRecordForUser } from "../src/utils/activex.service";

config();

async function batchSync() {
	await connectDB();
	const apiKey = process.env.ACTIVEX_API_KEY;
	const baseUrl = process.env.ACTIVEX_BASE_URL ?? "https://api.activex.ai/external/bca";

	console.log("=== Batch Syncing ActiveX Scans for All Members ===");

	const users = await User.find({ phone: { $exists: true, $ne: "" } }).select("username phone onboardingStatus");
	console.log(`Found ${users.length} members with phone numbers in database.`);

	const phoneToUserMap = new Map<string, any>();
	const phoneList: string[] = [];

	for (const u of users) {
		const formatted = formatPhoneForActiveX(u.phone);
		const last10 = u.phone.replace(/\D/g, "").slice(-10);
		phoneToUserMap.set(last10, u);
		phoneList.push(formatted);
	}

	console.log(`Querying ActiveX API for ${phoneList.length} numbers...`);

	try {
		const res = await fetch(baseUrl, {
			method: "POST",
			headers: {
				"x-api-key": apiKey!,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				Date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
				PhoneNumbers: phoneList,
			}),
		});

		const data = (await res.json()) as any;
		console.log(`ActiveX API Response status: ${res.status}`);
		
		const records = data?.result?.records ?? [];
		console.log(`Found ${records.length} total scan records from ActiveX cloud!`);

		let syncedCount = 0;
		for (const record of records) {
			const rawPhone = String(record.phone || "");
			const last10 = rawPhone.replace(/\D/g, "").slice(-10);
			const user = phoneToUserMap.get(last10);
			if (user) {
				await upsertBcaRecordForUser(user._id, record);
				syncedCount++;
				console.log(`✅ Synced scan for ${user.username} (${user.phone}) - Date: ${record.insertionDate || "recent"}`);
			} else {
				console.log(`⚠️ Scan found for phone ${rawPhone}, but no matching user in DB.`);
			}
		}

		console.log(`\n=== Summary ===`);
		console.log(`Successfully synced ${syncedCount} scans.`);
		
		const completedUsers = await User.countDocuments({ "onboardingStatus.activeXTestCompleted": true });
		console.log(`Total users with Active X completed in DB: ${completedUsers}`);

	} catch (err: any) {
		console.error("Batch sync error:", err.message);
	}

	process.exit(0);
}

batchSync().catch((err) => {
	console.error(err);
	process.exit(1);
});
