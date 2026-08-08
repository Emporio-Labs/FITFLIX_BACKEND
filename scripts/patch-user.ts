import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

config();

const USER_ID = "6a76f85c292f4add32730794";
const NEW_PASSWORD = "Test@1234";

async function main() {
	try {
		await connectDB();

		const passwordHash = await hashPassword(NEW_PASSWORD);

		const updated = await User.findByIdAndUpdate(
			USER_ID,
			{ passwordHash, onboarded: true },
			{ new: true },
		).select("_id email onboarded");

		if (!updated) {
			console.error("User not found:", USER_ID);
			process.exit(1);
		}

		console.log("User updated successfully:");
		console.log("  ID:        ", updated._id.toString());
		console.log("  Email:     ", updated.email);
		console.log("  Onboarded: ", updated.onboarded);
		console.log("  Password:  ", NEW_PASSWORD, "(set)");
	} catch (error) {
		console.error("Failed to update user:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
