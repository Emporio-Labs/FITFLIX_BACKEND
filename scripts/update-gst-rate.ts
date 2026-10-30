import { config } from "dotenv";
import connectDB from "../src/utils/db";
import BillingSettings from "../src/models/BillingSettings";
import Location from "../src/models/Location";

config();

async function run() {
	await connectDB();
	console.log("Connected to MongoDB.");

	const billing = await BillingSettings.findOneAndUpdate(
		{},
		{
			$set: {
				taxRatePercent: 5,
				currency: "INR",
				sacCode: "999723",
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	);
	console.log("BillingSettings updated:", billing);

	const locResult = await Location.updateMany(
		{},
		{ $set: { "settings.taxRatePercent": 5 } },
	);
	console.log(`Updated ${locResult.modifiedCount} location(s) to 5% GST.`);

	process.exit(0);
}

run().catch((err) => {
	console.error("Migration error:", err);
	process.exit(1);
});
