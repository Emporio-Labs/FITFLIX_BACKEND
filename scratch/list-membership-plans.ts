// Read-only: list all MembershipPlan documents so the user app's pricing
// section can be verified against real catalog data.
import mongoose from "mongoose";
import MembershipPlan from "../src/models/MembershipPlan";

async function main() {
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) throw new Error("MONGODB_URL is required in .env");
	await mongoose.connect(mongoUrl);

	const plans = await MembershipPlan.find().lean();
	console.log(`Found ${plans.length} membership plan(s):`);
	console.log(JSON.stringify(plans, null, 2));

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
