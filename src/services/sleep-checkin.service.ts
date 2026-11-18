/**
 * Morning sleep check-in: one push a day asking members to log last night.
 *
 * When: about 45 minutes after the member usually wakes up (the median wake
 * time of their own last 14 logged nights), which is when they are on their
 * phone and still remember when they went to bed. Until there are 3 nights to
 * learn from: 08:30 on weekdays, 09:30 at weekends. Always between 07:00 and
 * 21:00: a night-shift member who sleeps 7 AM–3 PM gets it at about 3:45 PM,
 * not at 11 AM while still asleep. Pushed past the member's quiet hours, and
 * skipped for the day (never sent late) once the hour after the target has
 * passed. A member can also pick a fixed time (05:00–21:00) in Notification
 * Settings.
 *
 * Not sent when:
 *  - this morning's night is already logged (by hand or by a watch);
 *  - a watch synced a night's sleep in the last 2 days (it logs sleep for
 *    them; a phone that syncs only steps doesn't count);
 *  - the member turned it off, or turned push off altogether;
 *  - the last 5 check-ins were all ignored. It resumes by itself as soon as
 *    the member logs any night again.
 *
 * Runs from processReminders() (in-process poller, or the external
 * /internal/reminders/tick on serverless), throttled to every 5 minutes.
 */
import type mongoose from "mongoose";
import { NotificationChannel, NotificationKind } from "../models/Enums";
import NotificationPreferences from "../models/NotificationPreferences";
import SleepCheckInState from "../models/sleep-checkin-state.model";
import SleepLog, { SleepSource } from "../models/sleep-log.model";
import User from "../models/User";
import {
	DEFAULT_TIMEZONE,
	dayOfWeekInZone,
	formatDateInZone,
	minutesIntoDayInZone,
} from "../utils/timezone.util";
import { isQuietHoursNow } from "./notification-filter.service";
import { notify } from "./notification.service";

export const SLEEP_CHECKIN = {
	weekdayDefault: 8 * 60 + 30,
	weekendDefault: 9 * 60 + 30,
	earliest: 7 * 60,
	// Late enough for night-shift members who wake mid-afternoon; before the
	// default quiet hours (22:00).
	latest: 21 * 60,
	afterWakeMinutes: 45,
	minNightsForAuto: 3,
	historyNights: 14,
	/** Send at the first sweep in [target, target + this); otherwise skip the day. */
	sendWindowMinutes: 60,
	pauseAfterIgnored: 5,
	watchFreshDays: 2,
	/** The sweep does nothing outside these IST minutes (targets are 05:00–21:00, plus the send window). */
	sweepStart: 5 * 60,
	sweepEnd: 22 * 60,
	sweepIntervalMs: 5 * 60 * 1000,
} as const;

export const SLEEP_CHECKIN_TEXT = {
	title: "Good morning ☀️ How did you sleep?",
	// After noon (night shifts): no "good morning", and not "last night".
	titleLater: "How did you sleep?",
	body: "Log last night in 2 taps.",
	bodyLater: "Log your sleep in 2 taps.",
} as const;

const parseHHmm = (t: string): number => {
	const [h, m] = t.split(":").map(Number);
	return (h ?? 0) * 60 + (m ?? 0);
};

export function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[mid]!
		: Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Minute of the IST day to send at. `wakeMinutes` are the member's recent
 * wake-up times (minutes into the IST day), newest first.
 */
export function resolveCheckInMinute(input: {
	fixedTime: string | null | undefined;
	wakeMinutes: number[];
	isWeekend: boolean;
	quietHours?: { enabled: boolean; startTime: string; endTime: string } | null;
}): number {
	let target: number;
	if (input.fixedTime) {
		target = parseHHmm(input.fixedTime);
	} else {
		const recent = input.wakeMinutes.slice(0, SLEEP_CHECKIN.historyNights);
		const usualWake =
			recent.length >= SLEEP_CHECKIN.minNightsForAuto ? median(recent) : null;
		target =
			usualWake === null
				? input.isWeekend
					? SLEEP_CHECKIN.weekendDefault
					: SLEEP_CHECKIN.weekdayDefault
				: Math.min(
						SLEEP_CHECKIN.latest,
						Math.max(
							SLEEP_CHECKIN.earliest,
							usualWake + SLEEP_CHECKIN.afterWakeMinutes,
						),
					);
	}

	// A push inside quiet hours would arrive silently and the day's chance is
	// gone, so wait for quiet hours to end instead.
	const q = input.quietHours;
	if (q?.enabled && isQuietHoursNow(q.startTime, q.endTime, target)) {
		target = parseHHmm(q.endTime);
	}
	return target;
}

export function isDue(nowMinute: number, targetMinute: number): boolean {
	return (
		nowMinute >= targetMinute &&
		nowMinute < targetMinute + SLEEP_CHECKIN.sendWindowMinutes
	);
}

/** YYYY-MM-DD shifted by whole days. */
function shiftDate(date: string, days: number): string {
	const t = new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
}

/**
 * Whether the member's check-in is on, and whether it is paused because the
 * last few went unanswered. "Paused" mirrors exactly what the sweep would
 * decide at its next run, so the app can ask "Keep sleep reminders?".
 */
export async function getSleepCheckInStatus(
	userId: string,
): Promise<{ enabled: boolean; paused: boolean }> {
	const [pref, state] = await Promise.all([
		NotificationPreferences.findOne({ userId })
			.select("masterPushEnabled habits")
			.lean(),
		SleepCheckInState.findOne({ userId }).lean(),
	]);
	const enabled =
		pref?.masterPushEnabled !== false && pref?.habits?.sleepCheckInEnabled !== false;
	let paused = false;
	if (
		enabled &&
		state?.lastSentDate &&
		state.ignoredInARow + 1 >= SLEEP_CHECKIN.pauseAfterIgnored
	) {
		const answered = await SleepLog.exists({
			userId,
			date: { $gte: state.lastSentDate },
		});
		paused = !answered;
	}
	return { enabled, paused };
}

/** "Keep reminders": clear the ignored streak so the next morning sends again. */
export async function resumeSleepCheckIn(userId: string): Promise<void> {
	await SleepCheckInState.updateOne({ userId }, { $set: { ignoredInARow: 0 } });
}

export interface SleepCheckInSweepResult {
	sent: number;
	paused: number;
}

export async function sendSleepCheckIns(
	now = new Date(),
): Promise<SleepCheckInSweepResult> {
	const result: SleepCheckInSweepResult = { sent: 0, paused: 0 };

	const nowMinute = minutesIntoDayInZone(now, DEFAULT_TIMEZONE);
	if (nowMinute < SLEEP_CHECKIN.sweepStart || nowMinute >= SLEEP_CHECKIN.sweepEnd) {
		return result;
	}
	const today = formatDateInZone(now, DEFAULT_TIMEZONE);
	const dow = dayOfWeekInZone(now, DEFAULT_TIMEZONE);
	const isWeekend = dow === 0 || dow === 6;

	// Members who finished onboarding and have a phone to push to. Staff
	// accounts carry a staffRole; members don't.
	const members = await User.find({
		staffRole: null,
		onboarded: true,
		"fcmTokens.0": { $exists: true },
	})
		.select("_id")
		.lean<{ _id: mongoose.Types.ObjectId }[]>();
	if (members.length === 0) return result;
	const ids = members.map((m) => m._id);

	const [prefs, states, loggedToday, freshWatch] = await Promise.all([
		NotificationPreferences.find({ userId: { $in: ids } })
			.select("userId masterPushEnabled habits quietHours")
			.lean(),
		SleepCheckInState.find({ userId: { $in: ids } }).lean(),
		SleepLog.find({ userId: { $in: ids }, date: today }).select("userId").lean(),
		// "The watch tracks your sleep" means it actually synced *sleep*
		// recently, not just that something synced: an iPhone without a watch
		// syncs steps but never sleep, and those members still need the nudge.
		SleepLog.find({
			userId: { $in: ids },
			source: { $ne: SleepSource.Manual },
			date: { $gte: shiftDate(today, -SLEEP_CHECKIN.watchFreshDays) },
		})
			.select("userId")
			.lean(),
	]);
	const prefsByUser = new Map(prefs.map((p) => [String(p.userId), p]));
	const stateByUser = new Map(states.map((s) => [String(s.userId), s]));
	const loggedTodaySet = new Set(loggedToday.map((l) => String(l.userId)));
	const freshWatchSet = new Set(freshWatch.map((w) => String(w.userId)));

	type Pending = {
		id: mongoose.Types.ObjectId;
		fixedTime: string | null;
		pref: (typeof prefs)[number] | undefined;
		state: (typeof states)[number] | undefined;
	};
	const pending: Pending[] = [];
	const engagedAgain: mongoose.Types.ObjectId[] = [];

	for (const id of ids) {
		const key = String(id);
		const pref = prefsByUser.get(key);
		const state = stateByUser.get(key);
		if (pref?.masterPushEnabled === false) continue;
		if (pref?.habits?.sleepCheckInEnabled === false) continue;
		if (state?.lastSentDate === today) continue;
		if (loggedTodaySet.has(key)) {
			if ((state?.ignoredInARow ?? 0) > 0) engagedAgain.push(id);
			continue;
		}
		if (freshWatchSet.has(key)) continue;
		pending.push({
			id,
			fixedTime: pref?.habits?.sleepCheckInTime ?? null,
			pref,
			state,
		});
	}

	if (engagedAgain.length > 0) {
		await SleepCheckInState.updateMany(
			{ userId: { $in: engagedAgain } },
			{ $set: { ignoredInARow: 0 } },
		);
	}
	if (pending.length === 0) return result;

	// Recent wake-up times, only for members on the automatic schedule.
	const autoIds = pending.filter((p) => !p.fixedTime).map((p) => p.id);
	const wakeByUser = new Map<string, number[]>();
	if (autoIds.length > 0) {
		const history = await SleepLog.find({
			userId: { $in: autoIds },
			date: { $gte: shiftDate(today, -(SLEEP_CHECKIN.historyNights + 7)), $lt: today },
		})
			.select("userId wakeTime")
			.sort({ date: -1 })
			.lean();
		for (const night of history) {
			if (!night.wakeTime) continue;
			const key = String(night.userId);
			const list = wakeByUser.get(key) ?? [];
			list.push(minutesIntoDayInZone(new Date(night.wakeTime), DEFAULT_TIMEZONE));
			wakeByUser.set(key, list);
		}
	}

	for (const p of pending) {
		const key = String(p.id);
		const target = resolveCheckInMinute({
			fixedTime: p.fixedTime,
			wakeMinutes: wakeByUser.get(key) ?? [],
			isWeekend,
			quietHours: p.pref?.quietHours ?? null,
		});
		if (!isDue(nowMinute, target)) continue;

		// Was the previous check-in followed by any logged night since?
		let ignored = p.state?.ignoredInARow ?? 0;
		if (p.state?.lastSentDate) {
			const answered = await SleepLog.exists({
				userId: p.id,
				date: { $gte: p.state.lastSentDate },
			});
			ignored = answered ? 0 : ignored + 1;
		}
		if (ignored >= SLEEP_CHECKIN.pauseAfterIgnored) {
			result.paused++;
			continue;
		}

		// Claim the day. The filter can't match a row already sent today, so
		// the upsert then tries to insert a second document with the same _id
		// (the member's id), MongoDB refuses it (11000) and we skip.
		try {
			await SleepCheckInState.findOneAndUpdate(
				{ _id: p.id, lastSentDate: { $ne: today } },
				{
					$set: { lastSentDate: today, ignoredInARow: ignored },
					$setOnInsert: { userId: p.id },
				},
				{ upsert: true },
			);
		} catch (err) {
			if ((err as { code?: number }).code === 11000) continue;
			throw err;
		}

		const morning = nowMinute < 12 * 60;
		await notify({
			userId: key,
			kind: NotificationKind.HabitReminder,
			title: morning ? SLEEP_CHECKIN_TEXT.title : SLEEP_CHECKIN_TEXT.titleLater,
			body: morning ? SLEEP_CHECKIN_TEXT.body : SLEEP_CHECKIN_TEXT.bodyLater,
			// The app routes reminder=sleep_check_in to /sleep-graph?log=1.
			data: { reminder: "sleep_check_in", date: today },
			channels: [NotificationChannel.Push, NotificationChannel.InApp],
		});
		result.sent++;
	}

	return result;
}
