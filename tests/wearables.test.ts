/**
 * End-to-end checks for /api/v1/wearables over real HTTP and a real MongoDB.
 *
 * Run against a throwaway database only — this drops it when done:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/wearabletest bun run test:wearables
 */
import mongoose from "mongoose";
import SleepLog, { SleepSource } from "../src/models/sleep-log.model";
import User from "../src/models/User";
import {
	WearableConnection,
	WearableDaily,
} from "../src/models/wearable.model";
import { deleteAndAnonymizeUserData } from "../src/utils/deletion-engine.service";
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

const BASE = "/api/v1/wearables";

async function main() {
	await mongoose.connect(url);
	const db = mongoose.connection.db!;
	await db.dropDatabase();
	await Promise.all([
		User.init(),
		SleepLog.init(),
		WearableDaily.init(),
		WearableConnection.init(),
	]);

	const trainerId = new mongoose.Types.ObjectId();
	const otherTrainerId = new mongoose.Types.ObjectId();
	const adultMember = await User.create({
		username: "Adult Member",
		phone: "+919000000001",
		dateOfBirth: new Date("1994-01-15"),
		assignedTrainer: trainerId,
	});
	const minorMember = await User.create({
		username: "Minor Member",
		phone: "+919000000002",
		dateOfBirth: new Date("2011-05-01"),
	});

	const memberToken = generateTestToken("user", adultMember.id);
	const minorToken = generateTestToken("user", minorMember.id);
	const trainerToken = generateTestToken("trainer", trainerId.toString());
	const otherTrainerToken = generateTestToken(
		"trainer",
		otherTrainerId.toString(),
	);
	const frontdeskToken = generateTestToken(
		"frontdesk",
		new mongoose.Types.ObjectId().toString(),
	);

	const { baseUrl, close } = await startTestServer();
	const call = (path: string, token: string, method = "GET", body?: unknown) =>
		fetchJson(baseUrl, `${BASE}${path}`, { method, token, body });

	const syncBody = {
		source: "HEALTH_CONNECT",
		days: [
			{
				date: "2026-11-15",
				steps: 8123,
				activeCaloriesKcal: 410,
				restingHeartRate: 62,
			},
			{ date: "2026-11-16", steps: 10456, workoutCount: 1, workoutMinutes: 45 },
		],
		sleep: [
			{
				date: "2026-11-16",
				bedtime: "2026-11-15T17:30:00.000Z",
				wakeTime: "2026-11-16T01:00:00.000Z",
				durationMinutes: 450,
			},
			{
				date: "2026-11-15",
				bedtime: "2026-11-14T18:00:00.000Z",
				wakeTime: "2026-11-15T01:30:00.000Z",
				durationMinutes: 450,
			},
		],
	};

	console.log("\n── Consent is required, server-side ──");
	{
		const r = await call("/sync", memberToken, "POST", syncBody);
		check(
			"sync without consent is refused",
			r.status === 403 && r.data.code === "CONSENT_REQUIRED",
			r,
		);
		const c = await call("/consent", memberToken);
		check(
			"consent starts off and the adult is eligible",
			c.data.data.wearableSync === false && c.data.data.eligible === true,
			c.data,
		);
	}

	console.log("\n── Minors ──");
	{
		const r = await call("/consent", minorToken, "PATCH", {
			wearableSync: true,
		});
		check(
			"a minor cannot switch sync on",
			r.status === 403 &&
				r.data.code === "NOT_ELIGIBLE" &&
				/under 18/.test(r.data.error),
			r,
		);
		const c = await call("/consent", minorToken);
		check("and is told they're not eligible", c.data.data.eligible === false);
	}

	console.log("\n── Sync ──");
	{
		const g = await call("/consent", memberToken, "PATCH", {
			wearableSync: true,
		});
		check(
			"an adult can switch sync on",
			g.status === 200 && g.data.data.wearableSync === true,
			g.data,
		);
		check(
			"coach sharing stays off unless asked for",
			g.data.data.coachSharing === false,
		);

		// A night the member logged by hand must survive a sync.
		await SleepLog.create({
			userId: adultMember._id,
			date: "2026-11-15",
			bedtime: new Date("2026-11-14T16:00:00Z"),
			wakeTime: new Date("2026-11-15T00:00:00Z"),
			durationMinutes: 480,
			source: SleepSource.Manual,
		});

		const r = await call("/sync", memberToken, "POST", syncBody);
		check("sync is accepted", r.status === 200, r);
		check(
			"one night synced, the hand-logged night skipped",
			r.data.data?.sleepUpserted === 1 && r.data.data?.sleepSkippedManual === 1,
			r.data,
		);

		const again = await call("/sync", memberToken, "POST", syncBody);
		check("re-sending the same batch is safe", again.status === 200);
		check(
			"no duplicate days after a resend",
			(await WearableDaily.countDocuments({ userId: adultMember._id })) === 2,
		);

		const manual = await SleepLog.findOne({
			userId: adultMember._id,
			date: "2026-11-15",
		}).lean();
		check(
			"the manual night is untouched",
			manual?.source === SleepSource.Manual && manual.durationMinutes === 480,
		);
		const synced = await SleepLog.findOne({
			userId: adultMember._id,
			date: "2026-11-16",
		}).lean();
		check(
			"the synced night lands in the sleep log",
			synced?.source === SleepSource.HealthConnect,
		);

		const series = await call(
			"/daily?from=2026-11-14&to=2026-11-16",
			memberToken,
		);
		const days = series.data.data?.daily ?? [];
		check("series has one entry per day", days.length === 3, days);
		check(
			"values come through",
			days[2]?.steps === 10456 && days[1]?.restingHeartRate === 62,
			days,
		);
		check(
			"an empty day is reported as empty",
			days[0]?.source === null && days[0]?.steps === undefined,
		);

		const bad = await call("/sync", memberToken, "POST", {
			source: "HEALTH_CONNECT",
			days: [{ date: "2026-11-16", restingHeartRate: 900 }],
		});
		check("impossible readings are rejected", bad.status === 400);
		const fit = await call("/sync", memberToken, "POST", {
			source: "GOOGLE_FIT",
			days: [],
		});
		check("unsupported sources are rejected", fit.status === 400);

		const conns = await call("/connections", memberToken);
		check(
			"the source shows as connected with a last-sync time",
			conns.data.data?.[0]?.source === "HEALTH_CONNECT" &&
				!!conns.data.data?.[0]?.lastSyncedAt,
			conns.data,
		);
	}

	console.log("\n── Staff visibility ──");
	{
		const before = await call(
			`/members/${adultMember.id}/daily?days=3`,
			trainerToken,
		);
		check(
			"the coach sees nothing before the member shares",
			before.status === 200 &&
				before.data.data.sharing === false &&
				before.data.data.daily.length === 0,
			before.data,
		);

		await call("/consent", memberToken, "PATCH", { coachSharing: true });
		const after = await call(
			`/members/${adultMember.id}/daily?from=2026-11-14&to=2026-11-16`,
			trainerToken,
		);
		check(
			"the assigned coach sees it once shared",
			after.data.data?.sharing === true &&
				after.data.data.daily[2].steps === 10456,
			after.data,
		);

		const other = await call(
			`/members/${adultMember.id}/daily`,
			otherTrainerToken,
		);
		check(
			"another trainer is refused",
			other.status === 403 && other.data.code === "NOT_YOUR_MEMBER",
			other,
		);

		const fd = await call(`/members/${adultMember.id}/daily`, frontdeskToken);
		check("front desk is refused", fd.status === 403, fd);

		const self = await call(`/members/${adultMember.id}/daily`, memberToken);
		check("members cannot use the staff route", self.status === 403, self);
	}

	console.log("\n── Withdrawal and disconnect delete data ──");
	{
		await call("/connections/HEALTH_CONNECT", memberToken, "DELETE");
		check(
			"disconnect deletes that source's daily data",
			(await WearableDaily.countDocuments({ userId: adultMember._id })) === 0,
		);
		check(
			"and its synced sleep",
			(await SleepLog.countDocuments({
				userId: adultMember._id,
				source: SleepSource.HealthConnect,
			})) === 0,
		);
		check(
			"but keeps hand-logged sleep",
			(await SleepLog.countDocuments({
				userId: adultMember._id,
				source: SleepSource.Manual,
			})) === 1,
		);

		await call("/sync", memberToken, "POST", syncBody);
		const off = await call("/consent", memberToken, "PATCH", {
			wearableSync: false,
		});
		check(
			"turning sync off also turns sharing off",
			off.data.data.wearableSync === false &&
				off.data.data.coachSharing === false,
			off.data,
		);
		check(
			"turning sync off deletes everything synced",
			(await WearableDaily.countDocuments({ userId: adultMember._id })) === 0 &&
				(await WearableConnection.countDocuments({
					userId: adultMember._id,
				})) === 0,
		);
	}

	console.log("\n── Account deletion ──");
	await call("/consent", memberToken, "PATCH", { wearableSync: true });
	await call("/sync", memberToken, "POST", syncBody);
	await deleteAndAnonymizeUserData(adultMember.id);
	check(
		"account deletion removes wearable data",
		(await WearableDaily.countDocuments({ userId: adultMember._id })) === 0,
	);
	check(
		"and all sleep logs",
		(await SleepLog.countDocuments({ userId: adultMember._id })) === 0,
	);

	await close();
	await db.dropDatabase();
	await mongoose.disconnect();
	console.log(
		failed === 0
			? "\nAll wearable checks passed."
			: `\n${failed} check(s) FAILED.`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
