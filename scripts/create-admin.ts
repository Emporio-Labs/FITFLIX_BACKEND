import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Location from "../src/models/Location";
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
	console.log(
		"Branch scope: --global (HQ / every branch) or --location <code> (repeat for multiple branches).",
	);
	console.log(
		"Default: --global, so behaviour matches pre-migration scripts.",
	);
}

type ParsedArgs = { flags: Set<string>; values: Record<string, string[]> };

function parseArgs(argv: string[]): ParsedArgs {
	const flags = new Set<string>();
	const values: Record<string, string[]> = {};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];

		if (!token?.startsWith("--")) {
			continue;
		}

		const key = token.slice(2);
		const next = argv[index + 1];

		if (!next || next.startsWith("--")) {
			flags.add(key);
			continue;
		}

		(values[key] ??= []).push(next);
		index += 1;
	}

	return { flags, values };
}

async function main() {
	try {
		const args = parseArgs(process.argv.slice(2));
		const pick = (key: string): string | undefined =>
			args.values[key]?.[0];

		const parsed = createAdminBodySchema.safeParse({
			adminName: pick("adminName") ?? pick("name"),
			email: pick("email"),
			phone: pick("phone"),
			password: pick("passwordHash") ?? pick("password"),
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

		const locationCodes = args.values.location ?? [];
		// Default to global so this script behaves the way it did pre-migration.
		// Any --location narrows it; --global re-asserts global explicitly.
		const isGlobal = args.flags.has("global") || locationCodes.length === 0;

		const locationIds: string[] = [];
		if (locationCodes.length > 0) {
			const found = await Location.find({
				code: { $in: locationCodes.map((c) => c.toLowerCase()) },
			}).select("_id code");

			for (const code of locationCodes) {
				const match = found.find(
					(loc: any) => loc.code === code.toLowerCase(),
				);
				if (!match) {
					console.error(`Unknown branch code: ${code}`);
					process.exit(1);
				}
				locationIds.push(match._id.toString());
			}
		}

		const admin = await Admin.create({
			adminName: parsed.data.adminName,
			email: parsed.data.email,
			phone: parsed.data.phone,
			passwordHash,
			locationIds,
			isGlobal,
		});

		console.log("Admin user created successfully.");
		console.log(`Admin ID: ${admin._id.toString()}`);
		console.log(`Admin email: ${admin.email}`);
		console.log(
			`Branch scope: ${
				isGlobal ? "global (every branch)" : locationCodes.join(", ")
			}`,
		);
	} catch (error) {
		console.error("Failed to create admin user:", error);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
	}
}

await main();
