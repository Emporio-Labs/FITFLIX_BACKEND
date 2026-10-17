import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

config();

async function run() {
	await connectDB();
	const email = "dandu@fitflix.in";
	const newPassword = "Password@123";

	const user = await User.findOne({ email });
	if (!user) {
		console.error(`User with email ${email} not found.`);
		process.exit(1);
	}

	const passwordHash = await hashPassword(newPassword);
	await User.updateOne({ _id: user._id }, { $set: { passwordHash } });

	console.log(`SUCCESS: Reset password for ${user.username} (${email}) to: ${newPassword}`);
	await mongoose.disconnect();
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
