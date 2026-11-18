/**
 * Who may read a member's sleep via GET /api/v1/sleep/series — real HTTP,
 * real MongoDB.
 *
 * Run against a throwaway database only — this drops it when done:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   JWT_SECRET=<any 32+ char test secret> \
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/sleepscopetest bun run test:sleep-scope
 */
import mongoose from "mongoose";
import SleepLog, { SleepSource } from "../src/models/sleep-log.model";
import User from "../src/models/User";
import { fetchJson, generateTestToken, startTestServer } from "./test-helpers";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}
process.env.MONGODB_URL = url;

let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
	if (ok) console.log(`  ✅ ${label}`);
	else {
		failed++;
		console.error(`  ❌ ${label}`, detail ?? "");
	}
};

const RANGE = "from=2026-11-14&to=2026-11-16";

async function main() {
	await mongoose.connect(url);
	const db = mongoose.connection.db!;
	await db.dropDatabase();
	await Promise.all([User.init(), SleepLog.init()]);

	const trainerId = new mongoose.Types.ObjectId();
	const otherTrainerId = new mongoose.Types.ObjectId();
	const member = await User.create({
		username: "Coached Member",
		phone: "+919000000101",
		dateOfBirth: new Date("1994-01-15"),
		assignedTrainer: trainerId,
	});
	const otherMember = await User.create({
		username: "Other Member",
		phone: "+919000000102",
		dateOfBirth: new Date("1990-03-02"),
	});

	await SleepLog.create([
		{
			userId: member._id,
			date: "2026-11-16",
			bedtime: new Date("2026-11-15T17:30:00Z"),
			wakeTime: new Date("2026-11-16T01:00:00Z"),
			durationMinutes: 450,
			source: SleepSource.Manual,
		},
		{
			userId: otherMember._id,
			date: "2026-11-16",
			bedtime: new Date("2026-11-15T18:00:00Z"),
			wakeTime: new Date("2026-11-16T00:00:00Z"),
			durationMinutes: 360,
			source: SleepSource.Manual,
		},
	]);

	const memberToken = generateTestToken("user", member.id);
	const otherMemberToken = generateTestToken("user", otherMember.id);
	const trainerToken = generateTestToken("trainer", trainerId.toString());
	const otherTrainerToken = generateTestToken(
		"trainer",
		otherTrainerId.toString(),
	);
	const frontdeskToken = generateTestToken(
		"frontdesk",
		new mongoose.Types.ObjectId().toString(),
	);
	const adminToken = generateTestToken(
		"admin",
		new mongoose.Types.ObjectId().toString(),
	);

	const { baseUrl, close } = await startTestServer();
	const series = (token: string, userId?: string) =>
		fetchJson(
			baseUrl,
			`/api/v1/sleep/series?${RANGE}${userId ? `&userId=${userId}` : ""}`,
			{ method: "GET", token },
		);
	// The two members slept different lengths on the 16th, which tells their data apart.
	const minutesOn16th = (r: any): number | null =>
		r.data?.data?.daily?.find((d: any) => d.date === "2026-11-16")
			?.durationMinutes ?? null;

	console.log("\n── Staff ──");
	{
		const r = await series(trainerToken, member.id);
		check(
			"the assigned trainer can read the member's sleep",
			r.status === 200 && minutesOn16th(r) === 450,
			r,
		);

		const other = await series(otherTrainerToken, member.id);
		check(
			"another trainer is refused with NOT_YOUR_MEMBER",
			other.status === 403 && other.data.code === "NOT_YOUR_MEMBER",
			other,
		);

		const notMine = await series(trainerToken, otherMember.id);
		check(
			"the trainer cannot read a member off their roster",
			notMine.status === 403 && notMine.data.code === "NOT_YOUR_MEMBER",
			notMine,
		);

		const fd = await series(frontdeskToken, member.id);
		check("front desk is refused", fd.status === 403, fd);

		const admin = await series(adminToken, member.id);
		check(
			"admins keep access",
			admin.status === 200 && minutesOn16th(admin) === 450,
			admin,
		);

		const bad = await series(trainerToken, "not-an-id");
		check("an invalid userId is a 400", bad.status === 400, bad);
		const twelve = await series(adminToken, "aaaaaaaaaaaa");
		check(
			"a 12-character string is not accepted as an id",
			twelve.status === 400,
			twelve,
		);
	}

	console.log("\n── Members ──");
	{
		const own = await series(memberToken);
		check(
			"a member gets their own sleep",
			own.status === 200 && minutesOn16th(own) === 450,
			own,
		);

		const ownExplicit = await series(memberToken, member.id);
		check(
			"passing their own id still works",
			ownExplicit.status === 200 && minutesOn16th(ownExplicit) === 450,
			ownExplicit,
		);

		const peek = await series(otherMemberToken, member.id);
		check(
			"a member cannot read someone else's sleep",
			peek.status === 403 && minutesOn16th(peek) === null,
			peek,
		);

		const otherOwn = await series(otherMemberToken);
		check(
			"and only ever sees their own",
			otherOwn.status === 200 && minutesOn16th(otherOwn) === 360,
			otherOwn,
		);
	}

	await close();
	await db.dropDatabase();
	await mongoose.disconnect();
	console.log(
		failed === 0
			? "\nAll sleep scope checks passed."
			: `\n${failed} check(s) FAILED.`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
