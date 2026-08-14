import { config } from "dotenv";
config();
import mongoose from "mongoose";
import GymVisit from "./src/models/GymVisit";
import User from "./src/models/User";

async function run() {
	await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/fitflix");
	const items = await GymVisit.find().lean().limit(1);
	console.log("items:", items);
	const it = items[0];
	if (!it) {
		console.log("No visits");
		process.exit(0);
	}
	console.log("it.userId type:", typeof it.userId);
	console.log("String(it.userId):", String(it.userId));
	const isValid = mongoose.Types.ObjectId.isValid(String(it.userId));
	console.log("isValidObjectId:", isValid);
	
	const userIds = Array.from(
		new Set(items.map((it: any) => String(it.userId)).filter(v => typeof v === "string" && mongoose.Types.ObjectId.isValid(v))),
	);
	const users = userIds.length
		? await User.find({ _id: { $in: userIds } })
				.select("username email")
				.lean()
		: [];
	const userById = new Map(users.map((u: any) => [String(u._id), u]));
	console.log("userById keys:", Array.from(userById.keys()));
	console.log("matched user:", userById.get(String(it.userId)));
	
	process.exit(0);
}
run();
