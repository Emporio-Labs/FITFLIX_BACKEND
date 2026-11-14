import mongoose from "mongoose";
import SleepLog, { SleepSource, type SleepLogDocument } from "../models/sleep-log.model";
import { DEFAULT_TIMEZONE, formatDateInZone } from "../utils/timezone.util";
import type { LogSleepInput } from "../validators/sleep.validator";

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

	let durationMinutes = input.durationMinutes;
	if (durationMinutes === undefined || durationMinutes <= 0) {
		let diffMs = wakeTime.getTime() - bedtime.getTime();
		if (diffMs < 0) {
			// Crosses midnight, wakeTime is next day
			diffMs += 24 * 60 * 60 * 1000;
		}
		durationMinutes = Math.round(diffMs / (1000 * 60));
	}

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

		if (bedtimes.length > 0) {
			const totalMins = bedtimes.reduce(
				(acc, b) => acc + (b.getHours() * 60 + b.getMinutes()),
				0,
			);
			const avgMins = Math.round(totalMins / bedtimes.length);
			const h = Math.floor(avgMins / 60);
			const m = avgMins % 60;
			const ampm = h >= 12 ? "PM" : "AM";
			const displayH = h % 12 === 0 ? 12 : h % 12;
			avgBedtimeTimeStr = `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
		}

		if (wakeTimes.length > 0) {
			const totalMins = wakeTimes.reduce(
				(acc, w) => acc + (w.getHours() * 60 + w.getMinutes()),
				0,
			);
			const avgMins = Math.round(totalMins / wakeTimes.length);
			const h = Math.floor(avgMins / 60);
			const m = avgMins % 60;
			const ampm = h >= 12 ? "PM" : "AM";
			const displayH = h % 12 === 0 ? 12 : h % 12;
			avgWakeTimeStr = `${displayH}:${m.toString().padStart(2, "0")} ${ampm}`;
		}
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
