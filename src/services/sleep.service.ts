import mongoose from "mongoose";
import SleepLog, { SleepSource, type SleepLogDocument } from "../models/sleep-log.model";
import {
	DEFAULT_TIMEZONE,
	formatDateInZone,
	minutesIntoDayInZone,
} from "../utils/timezone.util";
import type { LogSleepInput } from "../validators/sleep.validator";

/**
 * Average wall-clock time of some instants, as members see it (IST), e.g.
 * "11:15 PM". Read in the business timezone, never the server's: production
 * runs in UTC, where `getHours()` turned an 11 PM bedtime into 5 PM.
 *
 * With `wrapBeforeNoon`, morning times count as "after midnight" (00:30 →
 * 24:30) so bedtimes either side of midnight average sensibly.
 */
export function averageClockTime(
	instants: Date[],
	{ wrapBeforeNoon }: { wrapBeforeNoon: boolean },
): string | null {
	if (instants.length === 0) return null;
	const DAY = 24 * 60;
	const total = instants.reduce((acc, t) => {
		const mins = minutesIntoDayInZone(t, DEFAULT_TIMEZONE);
		return acc + (wrapBeforeNoon && mins < 12 * 60 ? mins + DAY : mins);
	}, 0);
	const avg = Math.round(total / instants.length) % DAY;
	const h = Math.floor(avg / 60);
	const m = avg % 60;
	const ampm = h >= 12 ? "PM" : "AM";
	const displayH = h % 12 === 0 ? 12 : h % 12;
	return `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
}

export interface SleepDaySummary {
	date: string;
	bedtime: Date | null;
	wakeTime: Date | null;
	durationMinutes: number;
	durationHours: number;
	qualityScore?: number;
	logged: boolean;
	source?: string;
	id?: string;
}

export interface SleepSeriesResponse {
	hasData: boolean;
	daysLogged: number;
	totalDays: number;
	avgDurationMinutes: number;
	avgDurationHours: number;
	goalDurationHours: number;
	avgBedtimeTimeStr: string | null;
	avgWakeTimeStr: string | null;
	daily: SleepDaySummary[];
}

export async function logSleep(
	userId: string,
	input: LogSleepInput,
): Promise<SleepLogDocument> {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const bedtime = new Date(input.bedtime);
	const wakeTime = new Date(input.wakeTime);

	// logSleepSchema guarantees bedtime < wakeTime < bedtime + 24h, so the span
	// is the night. A client-sent duration can only be shorter (time awake in
	// bed), never longer than the span itself.
	const spanMinutes = Math.round(
		(wakeTime.getTime() - bedtime.getTime()) / (1000 * 60),
	);
	const durationMinutes =
		input.durationMinutes !== undefined && input.durationMinutes > 0
			? Math.min(input.durationMinutes, spanMinutes)
			: spanMinutes;

	const doc = await SleepLog.findOneAndUpdate(
		{ userId: userObjectId, date: input.date },
		{
			$set: {
				userId: userObjectId,
				date: input.date,
				bedtime,
				wakeTime,
				durationMinutes,
				source: input.source || SleepSource.Manual,
				qualityScore: input.qualityScore,
				notes: input.notes,
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	);

	return doc;
}

export async function getSleepSeries(
	userId: string,
	fromStr?: string,
	toStr?: string,
	daysCount = 14,
): Promise<SleepSeriesResponse> {
	const userObjectId = new mongoose.Types.ObjectId(userId);
	const now = new Date();

	const endDayStr = toStr || formatDateInZone(now, DEFAULT_TIMEZONE);
	let startDayStr = fromStr;

	if (!startDayStr) {
		const endDate = new Date();
		const startDate = new Date(endDate.getTime() - (daysCount - 1) * 86400000);
		startDayStr = formatDateInZone(startDate, DEFAULT_TIMEZONE);
	}

	const logs = await SleepLog.find({
		userId: userObjectId,
		date: { $gte: startDayStr, $lte: endDayStr },
	})
		.sort({ date: 1 })
		.lean();

	const logsByDate = new Map<string, (typeof logs)[number]>();
	for (const l of logs) {
		logsByDate.set(l.date, l);
	}

	// Generate day list
	const daily: SleepDaySummary[] = [];
	const startDate = new Date(`${startDayStr}T00:00:00Z`);
	const endDate = new Date(`${endDayStr}T00:00:00Z`);

	let cursor = new Date(startDate);
	while (cursor <= endDate) {
		const dateKey = cursor.toISOString().slice(0, 10);
		const log = logsByDate.get(dateKey);
		if (log) {
			daily.push({
				date: dateKey,
				bedtime: log.bedtime,
				wakeTime: log.wakeTime,
				durationMinutes: log.durationMinutes,
				durationHours: Number((log.durationMinutes / 60).toFixed(1)),
				qualityScore: log.qualityScore ?? undefined,
				logged: true,
				source: log.source,
				id: log._id.toString(),
			});
		} else {
			daily.push({
				date: dateKey,
				bedtime: null,
				wakeTime: null,
				durationMinutes: 0,
				durationHours: 0,
				logged: false,
			});
		}
		cursor = new Date(cursor.getTime() + 86400000);
	}

	const loggedDays = daily.filter((d) => d.logged);
	const totalLoggedMins = loggedDays.reduce((acc, d) => acc + d.durationMinutes, 0);
	const avgDurationMinutes =
		loggedDays.length > 0 ? Math.round(totalLoggedMins / loggedDays.length) : 0;
	const avgDurationHours =
		loggedDays.length > 0 ? Number((avgDurationMinutes / 60).toFixed(1)) : 0;

	let avgBedtimeTimeStr: string | null = null;
	let avgWakeTimeStr: string | null = null;

	if (loggedDays.length > 0) {
		const bedtimes = loggedDays.filter((d) => d.bedtime).map((d) => d.bedtime!);
		const wakeTimes = loggedDays.filter((d) => d.wakeTime).map((d) => d.wakeTime!);

		// Bedtimes straddle midnight (11:30 PM, 12:30 AM), so average them on a
		// clock that runs on past midnight; a plain average of those two is noon.
		avgBedtimeTimeStr = averageClockTime(bedtimes, { wrapBeforeNoon: true });
		avgWakeTimeStr = averageClockTime(wakeTimes, { wrapBeforeNoon: false });
	}

	return {
		hasData: loggedDays.length > 0,
		daysLogged: loggedDays.length,
		totalDays: daily.length,
		avgDurationMinutes,
		avgDurationHours,
		goalDurationHours: 8.0,
		avgBedtimeTimeStr,
		avgWakeTimeStr,
		daily,
	};
}

export async function deleteSleepLog(
	userId: string,
	logId: string,
): Promise<boolean> {
	const res = await SleepLog.deleteOne({
		_id: new mongoose.Types.ObjectId(logId),
		userId: new mongoose.Types.ObjectId(userId),
	});
	return res.deletedCount > 0;
}
