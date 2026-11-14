/**
 * Local-only demo data for trying chat end to end: one admin, two trainers, a
 * nutritionist and three members (one assigned to each trainer, with active
 * memberships; one assigned to nobody, with none).
 *
 * Refuses anything that isn't a local MongoDB:
 *   MONGODB_URL=mongodb://127.0.0.1:27018/chatdev bun run scripts/seed-chat-demo.ts
 *
 * Every account shares one password: CHAT_DEMO_PASSWORD, or the default below.
 */
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import { hashPassword } from "../src/utils/password";

const url = process.env.MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error("MONGODB_URL must point at a local MongoDB. Refusing.");
	process.exit(1);
}

const password = process.env.CHAT_DEMO_PASSWORD ?? "chat-demo-1234";

async function main() {
	await mongoose.connect(url);
	const passwordHash = await hashPassword(password);

	const upsert = async (model: mongoose.Model<any>, email: string, doc: Record<string, unknown>) =>
		model.findOneAndUpdate(
			{ email },
			{ $set: { ...doc, email, passwordHash } },
			{ upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
		);

	await upsert(Admin, "admin@chat.test", { adminName: "Asha Admin", phone: "9000000001" });
	const trainerA = await upsert(Trainer, "ravi@chat.test", { trainerName: "Ravi Trainer", phone: "9000000002" });
	const trainerB = await upsert(Trainer, "meera@chat.test", { trainerName: "Meera Trainer", phone: "9000000003" });
	await upsert(User, "nina@chat.test", { username: "Nina Nutritionist", phone: "9000000004", staffRole: "nutritionist" });
	await upsert(User, "arjun@chat.test", { username: "Arjun Member", phone: "9000000005", assignedTrainer: trainerA._id, onboarded: true });
	await upsert(User, "kavya@chat.test", { username: "Kavya Member", phone: "9000000006", assignedTrainer: trainerB._id, onboarded: true });
	await upsert(User, "dev@chat.test", { username: "Dev Member", phone: "9000000007", onboarded: true });

	// Chat requires an active membership by default. Arjun and Kavya get one;
	// Dev is left without, to show what a lapsed member sees.
	const members = await User.find({
		email: { $in: ["arjun@chat.test", "kavya@chat.test"] },
	}).select("_id");
	const now = Date.now();
	for (const member of members) {
		await mongoose.connection.collection("memberships").updateOne(
			{ user: member._id, planName: "Chat demo plan" },
			{
				$set: {
					status: "Active",
					startDate: new Date(now - 30 * 86400_000),
					endDate: new Date(now + 335 * 86400_000),
				},
			},
			{ upsert: true },
		);
	}

	console.log("Seeded chat demo accounts (*@chat.test).");
	await mongoose.disconnect();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
