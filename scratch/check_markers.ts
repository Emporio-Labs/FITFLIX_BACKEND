import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/User";
import HealthMarkers from "../src/models/HealthMarkers";

dotenv.config();

async function run() {
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) {
		console.error("MONGODB_URL not found in environment");
		process.exit(1);
	}

	console.log("Connecting to MongoDB...");
	await mongoose.connect(mongoUrl);
	console.log("Connected.");

	const users = await User.find({});
	console.log(`Found ${users.length} users:`);
	for (const u of users) {
		const markers = await HealthMarkers.findOne({ userId: u._id });
		console.log(`- User: ${u.username} (${u.email}) [ID: ${u._id}]`);
		console.log(`  Age: ${u.age}, Gender: ${u.gender}, Onboarded: ${u.onboarded}`);
		if (markers) {
			console.log(`  Onboarding weight: ${markers.weight} kg, height: ${markers.height} cm, bmi: ${markers.bmi}`);
		} else {
			console.log("  No onboarding HealthMarkers found!");
		}
	}

	await mongoose.disconnect();
	console.log("Disconnected.");
}

run().catch(console.error);
