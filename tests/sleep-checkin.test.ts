/**
 * Morning sleep check-in push + manual sleep log validation, over real HTTP and
 * a real MongoDB.
 *
 * Run against a throwaway database only — this drops it when done:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/sleepcheckintest bun run test:sleep-checkin
 *
 * Pushes are never really sent: FCM credentials are cleared below, so each
 * check-in shows up only as its in-app Notification row, which is what the
 * checks count.
 */
import mongoose from "mongoose";
import { ExpertType, NotificationKind } from "../src/models/Enums";
import Notification from "../src/models/Notification";
import NotificationPreferences from "../src/models/NotificationPreferences";
import SleepCheckInState from "../src/models/sleep-checkin-state.model";
import SleepLog, { SleepSource } from "../src/models/sleep-log.model";
import User from "../src/models/User";
import { WearableConnection, WearableSource } from "../src/models/wearable.model";
import {
	isDue,
	median,
	resolveCheckInMinute,
	sendSleepCheckIns,
} from "../src/services/sleep-checkin.service";
import { fetchJson, generateTestToken, startTestServer } from "./test-helpers";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}
process.env.MONGODB_URL = url;
// Never reach Firebase or Web Push from a test run.
process.env.FCM_SERVICE_ACCOUNT_JSON = "";
for (const key of Object.keys(process.env)) {
	if (key.startsWith("VAPID")) process.env[key] = "";
}

let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
	if (ok) console.log(`  ✅ ${label}`);
	else {
		failed++;
		console.error(`  ❌ ${label}`, detail ?? "");
	}
};

/** An instant at HH:mm IST on a given IST day. */
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

const TODAY = "2026-11-18"; // a Wednesday
const YESTERDAY = "2026-11-17";

async function checkInsFor(userId: mongoose.Types.ObjectId) {
	return Notification.countDocuments({
		userId,
		kind: NotificationKind.HabitReminder,
		"data.reminder": "sleep_check_in",
	});
}

let phoneSeq = 0;
async function member(
	overrides: Record<string, unknown> = {},
): Promise<mongoose.Types.ObjectId> {
	phoneSeq++;
	const doc = await User.create({
		username: `Member ${phoneSeq}`,
		phone: `+9190000100${String(phoneSeq).padStart(2, "0")}`,
		dateOfBirth: new Date("1990-01-01"),
		onboarded: true,
		fcmTokens: [{ token: `test-token-${phoneSeq}`, platform: "android" }],
		...overrides,
	});
	return doc._id as mongoose.Types.ObjectId;
}

async function logNight(
	userId: mongoose.Types.ObjectId,
	date: string,
	wake: string,
	source = SleepSource.Manual,
) {
	const wakeTime = ist(date, wake);
	await SleepLog.create({
		userId,
		date,
		bedtime: new Date(wakeTime.getTime() - 8 * 3_600_000),
		wakeTime,
		durationMinutes: 480,
		source,
	});
}

async function main() {
	console.log("\n── When to send (pure rules) ──");
	check("median of odd count", median([420, 390, 400]) === 400);
	check("median of even count", median([400, 420]) === 410);
	check(
		"no history, weekday → 8:30",
		resolveCheckInMinute({ fixedTime: null, wakeMinutes: [], isWeekend: false }) ===
			8 * 60 + 30,
	);
	check(
		"no history, weekend → 9:30",
		resolveCheckInMinute({ fixedTime: null, wakeMinutes: [], isWeekend: true }) ===
			9 * 60 + 30,
	);
	check(
		"two nights is not enough history → default",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [390, 400],
			isWeekend: false,
		}) ===
			8 * 60 + 30,
	);
	check(
		"usual wake 6:30 → 7:15",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [390, 400, 380],
			isWeekend: false,
		}) ===
			7 * 60 + 15,
	);
	check(
		"very early riser is held to 7:00",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [300, 310, 320],
			isWeekend: false,
		}) ===
			7 * 60,
	);
	check(
		"night shift: usually up at 3 PM → 3:45 PM, after they wake",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [900, 890, 910],
			isWeekend: false,
		}) ===
			15 * 60 + 45,
	);
	check(
		"a very late waker is capped at 9 PM",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [1260, 1270, 1280],
			isWeekend: false,
		}) ===
			21 * 60,
	);
	check(
		"a fixed evening time is allowed (6 PM)",
		resolveCheckInMinute({ fixedTime: "18:00", wakeMinutes: [], isWeekend: false }) ===
			18 * 60,
	);
	check(
		"a fixed time wins",
		resolveCheckInMinute({
			fixedTime: "10:00",
			wakeMinutes: [390, 400, 380],
			isWeekend: false,
		}) ===
			10 * 60,
	);
	check(
		"inside quiet hours waits for them to end",
		resolveCheckInMinute({
			fixedTime: null,
			wakeMinutes: [],
			isWeekend: false,
			quietHours: { enabled: true, startTime: "22:00", endTime: "09:00" },
		}) ===
			9 * 60,
	);
	check("due at the target minute", isDue(510, 510));
	check("due 59 min later", isDue(569, 510));
	check("not due an hour later (skip the day)", !isDue(570, 510));
	check("not due before", !isDue(509, 510));

	await mongoose.connect(url);
	const db = mongoose.connection.db!;
	await db.dropDatabase();
	await Promise.all([
		User.init(),
		SleepLog.init(),
		SleepCheckInState.init(),
		NotificationPreferences.init(),
		WearableConnection.init(),
	]);

	console.log("\n── Who gets it ──");
	const plain = await member();
	const loggedAlready = await member();
	await logNight(loggedAlready, TODAY, "06:45");
	const watchUser = await member();
	await logNight(watchUser, YESTERDAY, "06:50", SleepSource.HealthConnect);
	// An iPhone without a watch: it syncs steps, never sleep.
	const stepsOnlyPhone = await member();
	await WearableConnection.create({
		userId: stepsOnlyPhone,
		source: WearableSource.AppleHealth,
		connectedAt: ist(YESTERDAY, "08:00"),
		lastSyncedAt: ist(YESTERDAY, "21:00"),
	});
	const optedOut = await member();
	await NotificationPreferences.create({
		userId: optedOut,
		habits: { sleepCheckInEnabled: false },
	});
	const pushOff = await member();
	await NotificationPreferences.create({ userId: pushOff, masterPushEnabled: false });
	const staff = await member({ staffRole: ExpertType.Trainer });
	const notOnboarded = await member({ onboarded: false });
	const noPhone = await member({ fcmTokens: [] });

	await sendSleepCheckIns(ist(TODAY, "02:00"));
	check("nothing goes out in the middle of the night", (await checkInsFor(plain)) === 0);

	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check("a member with no history gets it at 8:30 on a weekday", (await checkInsFor(plain)) === 1);
	check("not when this morning's night is already logged", (await checkInsFor(loggedAlready)) === 0);
	check("not when a watch synced sleep recently", (await checkInsFor(watchUser)) === 0);
	check(
		"but yes when a phone syncs only steps (no sleep from a watch)",
		(await checkInsFor(stepsOnlyPhone)) === 1,
	);
	check("not when switched off", (await checkInsFor(optedOut)) === 0);
	check("not when push is off altogether", (await checkInsFor(pushOff)) === 0);
	check("not to staff", (await checkInsFor(staff)) === 0);
	check("not before onboarding", (await checkInsFor(notOnboarded)) === 0);
	check("not without a phone to push to", (await checkInsFor(noPhone)) === 0);
	const sent = await Notification.findOne({ userId: plain }).lean();
	check(
		"it says what to do and where to go",
		sent?.title === "Good morning ☀️ How did you sleep?" &&
			(sent?.data as { reminder?: string; date?: string })?.reminder === "sleep_check_in" &&
			(sent?.data as { date?: string })?.date === TODAY,
		sent,
	);

	await sendSleepCheckIns(ist(TODAY, "08:40"));
	check("only once a day", (await checkInsFor(plain)) === 1);

	console.log("\n── Timing ──");
	const fixed = await member();
	await NotificationPreferences.create({
		userId: fixed,
		habits: { sleepCheckInTime: "10:00" },
	});
	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check("a fixed 10:00 isn't sent at 8:35", (await checkInsFor(fixed)) === 0);
	await sendSleepCheckIns(ist(TODAY, "10:05"));
	check("…and is sent at 10:05", (await checkInsFor(fixed)) === 1);

	const earlyRiser = await member();
	for (const d of ["2026-11-15", "2026-11-16", YESTERDAY]) {
		await logNight(earlyRiser, d, "06:30");
	}
	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check(
		"usual 6:30 waker: the 7:15–8:15 window has passed, so the day is skipped",
		(await checkInsFor(earlyRiser)) === 0,
	);
	const earlyRiser2 = await member();
	for (const d of ["2026-11-15", "2026-11-16", YESTERDAY]) {
		await logNight(earlyRiser2, d, "06:30");
	}
	await sendSleepCheckIns(ist(TODAY, "07:20"));
	check("usual 6:30 waker gets it at 7:15", (await checkInsFor(earlyRiser2)) === 1);

	// Night shift: sleeps ~7 AM–3 PM, logged under each wake-up day.
	const nightShift = await member();
	for (const d of ["2026-11-15", "2026-11-16", YESTERDAY]) {
		await logNight(nightShift, d, "15:00");
	}
	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check(
		"night-shift member is not pinged in the morning while asleep",
		(await checkInsFor(nightShift)) === 0,
	);
	await sendSleepCheckIns(ist(TODAY, "15:50"));
	check("…but gets it at 3:45 PM, after waking", (await checkInsFor(nightShift)) === 1);
	const afternoon = await Notification.findOne({ userId: nightShift }).lean();
	check(
		"and it doesn't say 'Good morning' in the afternoon",
		afternoon?.title === "How did you sleep?",
		afternoon?.title,
	);

	const lateQuiet = await member();
	await NotificationPreferences.create({
		userId: lateQuiet,
		quietHours: { enabled: true, startTime: "23:00", endTime: "09:00" },
	});
	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check("quiet hours until 9:00 hold it back", (await checkInsFor(lateQuiet)) === 0);
	await sendSleepCheckIns(ist(TODAY, "09:05"));
	check("…until they end", (await checkInsFor(lateQuiet)) === 1);

	console.log("\n── Ignored reminders pause it ──");
	const ignorer = await member();
	await SleepCheckInState.create({
		_id: ignorer,
		userId: ignorer,
		lastSentDate: YESTERDAY,
		ignoredInARow: 4,
	});
	await sendSleepCheckIns(ist(TODAY, "08:35"));
	check("after 5 ignored in a row it stops", (await checkInsFor(ignorer)) === 0);
	await logNight(ignorer, YESTERDAY, "07:00");
	await sendSleepCheckIns(ist(TODAY, "08:45"));
	check("logging any night brings it back", (await checkInsFor(ignorer)) === 1);
	const ignorerState = await SleepCheckInState.findOne({ userId: ignorer }).lean();
	check("and resets the count", ignorerState?.ignoredInARow === 0, ignorerState);

	console.log("\n── Keep sleep reminders? ──");
	const { baseUrl, close } = await startTestServer();
	const pausedMember = await member();
	await SleepCheckInState.create({
		_id: pausedMember,
		userId: pausedMember,
		lastSentDate: YESTERDAY,
		ignoredInARow: 4,
	});
	const pausedToken = generateTestToken("user", String(pausedMember));
	{
		const st = await fetchJson(baseUrl, "/api/v1/sleep/check-in", {
			token: pausedToken,
		});
		check("the app is told it's paused", st.data?.data?.paused === true, st);
		await sendSleepCheckIns(ist(TODAY, "08:35"));
		check("nothing is sent while paused", (await checkInsFor(pausedMember)) === 0);
		const rs = await fetchJson(baseUrl, "/api/v1/sleep/check-in/resume", {
			method: "POST",
			token: pausedToken,
		});
		check("Keep reminders un-pauses it", rs.data?.data?.paused === false, rs);
		await sendSleepCheckIns(ist(TODAY, "08:40"));
		check("and the next check sends it", (await checkInsFor(pausedMember)) === 1);
		const normal = await fetchJson(baseUrl, "/api/v1/sleep/check-in", {
			token: generateTestToken("user", String(plain)),
		});
		check(
			"a member who answers isn't paused",
			normal.data?.data?.paused === false && normal.data?.data?.enabled === true,
			normal,
		);
	}

	console.log("\n── No double sends ──");
	const racer = await member();
	await Promise.all([
		sendSleepCheckIns(ist(TODAY, "08:50")),
		sendSleepCheckIns(ist(TODAY, "08:50")),
		sendSleepCheckIns(ist(TODAY, "08:50")),
	]);
	check("three overlapping sweeps send exactly one", (await checkInsFor(racer)) === 1);

	console.log("\n── Manual sleep log validation ──");
	// Past dates on purpose: the server now refuses wake-ups in the future, so
	// nights dated "today" would depend on what time the test happens to run.
	const sleeper = await member();
	const token = generateTestToken("user", String(sleeper));
	const log = (body: unknown) =>
		fetchJson(baseUrl, "/api/v1/sleep/log", { method: "POST", token, body });

	{
		const r = await log({
			date: "2026-11-10",
			bedtime: ist("2026-11-09", "23:30").toISOString(),
			wakeTime: ist("2026-11-10", "07:00").toISOString(),
		});
		check("a normal night is saved", r.status === 200 || r.status === 201, r);
		const saved = await SleepLog.findOne({ userId: sleeper, date: "2026-11-10" }).lean();
		check("its duration is worked out (7.5 h)", saved?.durationMinutes === 450, saved);
		check(
			"and the instant is right (23:30 IST = 18:00 UTC)",
			saved?.bedtime?.toISOString() === "2026-11-09T18:00:00.000Z",
			saved?.bedtime,
		);
	}
	{
		const r = await log({
			date: "2026-11-12",
			bedtime: ist("2026-11-12", "07:00").toISOString(),
			wakeTime: ist("2026-11-12", "00:30").toISOString(),
		});
		check("wake before bedtime is refused", r.status === 400, r);
	}
	{
		const r = await log({
			date: "2026-11-12",
			bedtime: ist("2026-11-11", "00:30").toISOString(),
			wakeTime: ist("2026-11-12", "07:00").toISOString(),
		});
		check("a 30.5-hour night (the old app's bug) is refused", r.status === 400, r);
	}
	{
		const tomorrowWake = new Date(Date.now() + 24 * 3_600_000);
		const r = await log({
			date: tomorrowWake.toISOString().slice(0, 10),
			bedtime: new Date(tomorrowWake.getTime() - 8 * 3_600_000).toISOString(),
			wakeTime: tomorrowWake.toISOString(),
		});
		check("a wake-up that hasn't happened yet is refused", r.status === 400, r);
	}
	{
		const r = await log({
			date: "2026-11-11",
			bedtime: ist("2026-11-11", "00:30").toISOString(),
			wakeTime: ist("2026-11-11", "07:30").toISOString(),
		});
		check("an after-midnight bedtime is fine", r.status === 200 || r.status === 201, r);
	}
	{
		const r = await fetchJson(
			baseUrl,
			"/api/v1/sleep/series?from=2026-11-10&to=2026-11-11",
			{ token },
		);
		const data = r.data?.data ?? r.data;
		check(
			"average bedtime across midnight (11:30 PM, 12:30 AM) is 12:00 AM, not noon",
			data?.avgBedtimeTimeStr === "12:00 AM",
			data?.avgBedtimeTimeStr,
		);
		check(
			"average wake time is read in IST (7:00, 7:30 → 7:15 AM)",
			data?.avgWakeTimeStr === "7:15 AM",
			data?.avgWakeTimeStr,
		);
	}

	await close();
	await db.dropDatabase();
	await mongoose.disconnect();
	console.log(
		failed === 0
			? "\nAll sleep check-in checks passed."
			: `\n${failed} check(s) FAILED.`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
