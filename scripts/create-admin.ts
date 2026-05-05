import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";
import { createAdminBodySchema } from "../src/validators/admin.validator";

config();

function printUsage() {
	console.log(
		'Usage: bun run create:admin -- --adminName "Admin Name" --email admin@example.com --phone 9999999999 --passwordHash yourpassword',
	);
	console.log(
		"Also supported: --name and --password as aliases for --adminName and --passwordHash.",
	);
}

function parseArgs(argv: string[]) {
	const result: Record<string, string> = {};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];

		if (!token || !token.startsWith("--")) {
			continue;
		}

		const key = token.slice(2);
		const value = argv[index + 1];

		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for argument --${key}`);
		}

		result[key] = value;
		index += 1;
	}

	return result;
}

async function main() {
	try {
		const args = parseArgs(process.argv.slice(2));

		const parsed = createAdminBodySchema.safeParse({
			adminName: args.adminName ?? args.name,
			email: args.email,
			phone: args.phone,
			password: args.passwordHash ?? args.password,
		});

		if (!parsed.success) {
			console.error("Invalid input for admin creation");
			console.error(parsed.error.issues);
			printUsage();
			process.exit(1);
		}

		await connectDB();

		const existingAdmin = await Admin.findOne({
			email: parsed.data.email,
		}).select("_id");

		if (existingAdmin) {
			console.error("Admin with this email already exists.");
			process.exit(1);
		}

		const passwordHash = await hashPassword(parsed.data.password);

		const admin = await Admin.create({
			adminName: parsed.data.adminName,
			email: parsed.data.email,
			phone: parsed.data.phone,
			passwordHash,
		});

		console.log("Admin user created successfully.");
		console.log(`Admin ID: ${admin._id.toString()}`);
		console.log(`Admin email: ${admin.email}`);
	} catch (error) {
		console.error("Failed to create admin user:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
