import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/User";
import Membership from "../src/models/Membership";
import MembershipPlan from "../src/models/MembershipPlan";
import Trainer from "../src/models/Trainer";
import { MembershipStatus } from "../src/models/Enums";

dotenv.config();

async function main() {
	const uri = process.env.MONGODB_URL || process.env.MONGODB_URI;
	if (!uri) {
		console.error("MONGODB_URL not found");
		process.exit(1);
	}

	await mongoose.connect(uri);
	console.log("Connected to MongoDB");

	const user = await User.findOne({ email: "rahul@fitflix.in" });
	if (!user) {
		console.error("User rahul@fitflix.in not found");
		process.exit(1);
	}
	console.log(`Found user: ${user._id} (${user.name || user.username}, ${user.email})`);

	// Find an active trainer
	const trainer = await Trainer.findOne({ isActive: { $ne: false } });
	console.log(`Selected trainer: ${trainer?._id} (${trainer?.trainerName})`);

	// Check existing memberships
	const existing = await Membership.find({ userId: user._id });
	console.log(`Existing memberships count: ${existing.length}`);
	for (const m of existing) {
		console.log(` - ID: ${m._id}, Plan: ${m.planName}, Status: ${m.status}, ptRemaining: ${m.ptSessionsRemaining}`);
	}

	// Create or update PT Membership
	const now = new Date();
	const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

	// Let's create an active 14-session PT plan or update existing
	const ptMembership = await Membership.findOneAndUpdate(
		{
			user: user._id,
			status: MembershipStatus.Active,
		},
		{
			$set: {
				user: user._id,
				planName: "Personal Training 14 Classes",
				category: "PERSONAL_TRAINING",
				creditsIncluded: 0,
				creditsRemaining: 0,
				ptSessionsIncluded: 14,
				ptSessionsRemaining: 14,
				ptSessionsUsed: 0,
				assignedTrainerId: trainer?._id,
				assignedTrainerName: trainer?.trainerName || "",
				startDate: now,
				endDate: endOfMonth,
				status: MembershipStatus.Active,
				price: 14000,
				currency: "INR",
				allowEarlyRenewal: true,
			},
		},
		{ upsert: true, new: true },
	);

	console.log("\n✅ Successfully updated / created PT Membership for rahul@fitflix.in:");
	console.log({
		membershipId: ptMembership._id,
		planName: ptMembership.planName,
		category: ptMembership.category,
		ptSessionsIncluded: ptMembership.ptSessionsIncluded,
		ptSessionsRemaining: ptMembership.ptSessionsRemaining,
		assignedTrainer: trainer?.trainerName,
		startDate: ptMembership.startDate,
		endDate: ptMembership.endDate,
	});

	await mongoose.disconnect();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
