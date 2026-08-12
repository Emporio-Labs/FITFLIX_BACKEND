import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import MembershipPlan from "../src/models/MembershipPlan";

config();

async function main() {
	try {
		await connectDB();
		const plans = await MembershipPlan.find();
		console.log(`Found ${plans.length} plans:`);
		for (const plan of plans) {
			console.log(JSON.stringify(plan, null, 2));
		}
	} catch (error) {
		console.error("Error connecting or querying:", error);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
