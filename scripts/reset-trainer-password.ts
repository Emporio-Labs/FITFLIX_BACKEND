import { config } from "dotenv";
import mongoose from "mongoose";
import Trainer from "../src/models/Trainer";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

config();

function parseArgs(argv: string[]) {
	const result: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (!token?.startsWith("--")) continue;
		const key = token.slice(2);
		const value = argv[i + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for argument --${key}`);
		}
		result[key] = value;
		i++;
	}
	return result;
}

async function main() {
	try {
		const args = parseArgs(process.argv.slice(2));
		const email = (args.email || "mashenmi@fitflix.in").trim().toLowerCase();
		const newPassword = (args.password || "Trainer@123").trim();

		console.log(`Connecting to MongoDB...`);
		await connectDB();

		console.log(`Searching for trainer with email: ${email}`);
		const trainer = await Trainer.findOne({ email });
		if (!trainer) {
			console.error(`Trainer with email "${email}" not found.`);
			process.exit(1);
		}

		console.log(`Hashing new password...`);
		const passwordHash = await hashPassword(newPassword);

		trainer.passwordHash = passwordHash;
		await trainer.save();

		console.log(`=============================================`);
		console.log(`SUCCESS: Password updated for trainer:`);
		console.log(`Name:     ${trainer.trainerName}`);
		console.log(`Email:    ${trainer.email}`);
		console.log(`Password: ${newPassword}`);
		console.log(`=============================================`);
	} catch (error) {
		console.error("Failed to reset trainer password:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

main();
