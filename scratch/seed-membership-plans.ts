// Seed the membership-plan catalog with the three tiers the user app shows.
// Idempotent: inserts only when the collection is empty, never overwrites.
import mongoose from "mongoose";
import MembershipPlan from "../src/models/MembershipPlan";

const PLANS = [
	{
		name: "Explorer",
		description: "Start your longevity journey",
		price: 4999,
		currency: "INR",
		creditsIncluded: 10,
		features: [
			"10 therapy credits",
			"1 DNA collection kit",
			"Access to IV Drip sessions",
			"Clinician consultation",
			"Progress tracking",
		],
		active: true,
	},
	{
		name: "Optimizer",
		description: "Maximize your performance",
		price: 9999,
		currency: "INR",
		creditsIncluded: 25,
		features: [
			"25 therapy credits",
			"Full DNA analysis report",
			"All therapy modalities",
			"Priority slot booking",
			"Monthly biometric review",
			"Personalized protocol",
		],
		active: true,
	},
	{
		name: "Apex",
		description: "Elite human performance",
		price: 19999,
		currency: "INR",
		creditsIncluded: 60,
		features: [
			"60 therapy credits",
			"Quarterly DNA re-analysis",
			"All therapy modalities",
			"Concierge scheduling",
			"Weekly clinician review",
			"Custom longevity plan",
			"Guest passes (2/month)",
		],
		active: true,
	},
];

async function main() {
	const mongoUrl = process.env.MONGODB_URL;
	if (!mongoUrl) throw new Error("MONGODB_URL is required in .env");
	await mongoose.connect(mongoUrl);

	const existing = await MembershipPlan.countDocuments();
	if (existing > 0) {
		console.log(`Skipped: ${existing} plan(s) already exist — nothing inserted.`);
	} else {
		const created = await MembershipPlan.insertMany(PLANS);
		console.log(`Inserted ${created.length} membership plans:`);
		for (const p of created) {
			console.log(`  - ${p.name}: ${p.currency} ${p.price}, ${p.creditsIncluded} credits`);
		}
	}

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
