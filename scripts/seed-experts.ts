import { config } from "dotenv";
import mongoose from "mongoose";
import { AppointmentMode, ExpertType, Gender } from "../src/models/Enums";
import User from "../src/models/User";
import {
	getOrCreateExpertSchedule,
	updateExpertSchedule,
} from "../src/services/expert-schedule.service";
import connectDB from "../src/utils/db";
import { hashPassword } from "../src/utils/password";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run seed:experts [--dry-run]");
	console.log(
		"  --dry-run   Show what would be created/updated without writing",
	);
};

/**
 * Local-dev seed for the 1:1 expert flow.
 *
 * Pooled availability (`calculatePooledAvailability` /
 * `resolveExpertsOfType` in expert-schedule.service.ts) draws from `User`
 * documents carrying `staffRole`, each with an `ExpertSchedule`. Nothing in a
 * fresh DB has either — there was no persisted expert role before this
 * migration — so nutritionist/sports-scientist onboarding shows zero times
 * until this has run once.
 *
 * Idempotent: matched on email, upserted, and the schedule write goes through
 * `updateExpertSchedule`'s upsert rather than a raw `create`.
 */
const EXPERTS: Array<{
	expertType: ExpertType;
	username: string;
	email: string;
	phone: string;
	password: string;
}> = [
	{
		expertType: ExpertType.Nutritionist,
		username: "Dr. Priya Nutritionist",
		email: "nutritionist@fitflix.test",
		phone: "9000000001",
		password: "Password@123",
	},
	{
		expertType: ExpertType.SportsScientist,
		username: "Dr. Arjun Sports Scientist",
		email: "sportsscientist@fitflix.test",
		phone: "9000000002",
		password: "Password@123",
	},
];

async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	await connectDB();

	for (const expert of EXPERTS) {
		const existing = await User.findOne({ email: expert.email });

		if (dryRun) {
			console.log(
				`[dry-run] Would ${existing ? "update" : "create"} ${expert.expertType} — ${expert.email}`,
			);
			continue;
		}

		const passwordHash = await hashPassword(expert.password);

		const user = await User.findOneAndUpdate(
			{ email: expert.email },
			{
				$set: {
					username: expert.username,
					phone: expert.phone,
					age: 30,
					gender: Gender.Other,
					staffRole: expert.expertType,
					isActive: true,
					passwordHash,
				},
				$setOnInsert: {
					onboarded: true,
					onboardingStatus: { onboardingCompleted: true },
				},
			},
			{ upsert: true, new: true, setDefaultsOnInsert: true },
		);

		const userId = user._id.toString();

		// Creates the row if missing; a no-op shape if it already exists.
		await getOrCreateExpertSchedule(userId, expert.expertType);

		await updateExpertSchedule(
			userId,
			{
				weeklySlots: [
					{ dayOfWeek: 0, isAvailable: false, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 1, isAvailable: true, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 2, isAvailable: true, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 3, isAvailable: true, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 4, isAvailable: true, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 5, isAvailable: true, startTime: "09:00", endTime: "18:00" },
					{ dayOfWeek: 6, isAvailable: true, startTime: "09:00", endTime: "18:00" },
				],
				slotDurationMinutes: 45,
				bufferMinutes: 15,
				supportedModes: [AppointmentMode.IN_PERSON, AppointmentMode.ONLINE],
				maxAdvanceBookingDays: 60,
				isActive: true,
			},
			expert.expertType,
		);

		console.log(
			`${existing ? "Updated" : "Created"} ${expert.expertType}: ${expert.email} / ${expert.password}  (id ${userId})`,
		);
	}

	if (dryRun) {
		console.log("\nDry run — nothing was written.");
	} else {
		console.log(
			"\nDone. Sign in to the frontdesk with the emails/passwords above " +
				"to edit each expert's own availability, or edit as admin.",
		);
	}
}

main()
	.then(async () => {
		await mongoose.connection.close();
		process.exit(0);
	})
	.catch(async (err) => {
		console.error("Seed failed:", err);
		await mongoose.connection.close();
		process.exit(1);
	});
