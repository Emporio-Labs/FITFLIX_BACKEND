import mongoose from "mongoose";
import SleepLog, { SleepSource } from "../models/sleep-log.model";
import User from "../models/User";
import {
	WearableConnection,
	WearableDaily,
	WearableSource,
} from "../models/wearable.model";
import { DEFAULT_TIMEZONE, formatDateInZone } from "../utils/timezone.util";
import type { SyncWearableInput } from "../validators/wearable.validator";

const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);

/** Wearable sources map 1:1 onto the sleep log's non-manual sources. */
const SLEEP_SOURCE: Record<WearableSource, SleepSource> = {
	[WearableSource.AppleHealth]: SleepSource.AppleHealth,
	[WearableSource.HealthConnect]: SleepSource.HealthConnect,
};

const METRIC_KEYS = [
	"steps",
	"activeCaloriesKcal",
	"distanceMeters",
	"restingHeartRate",
	"avgHeartRate",
	"maxHeartRate",
	"workoutCount",
	"workoutMinutes",
	"weightKg",
] as const;

type MetricKey = (typeof METRIC_KEYS)[number];

export type WearableDay = { date: string; source: string | null } & Partial<
	Record<MetricKey, number>
>;

export interface SyncResult {
	daysUpserted: number;
	sleepUpserted: number;
	/** Nights skipped because the member had logged that night by hand. */
	sleepSkippedManual: number;
}

/**
 * Upserts a batch from the phone's health store.
 *
 * Sleep goes into the existing SleepLog collection (one per user per night)
 * so the sleep graph picks it up with no extra work. A night the member logged
 * by hand is never overwritten: they typed it deliberately, and the watch
 * guessing differently is not a reason to throw that away.
 */
export async function syncWearableData(
	userId: string,
	input: SyncWearableInput,
	now = new Date(),
): Promise<SyncResult> {
	const userObjectId = toObjectId(userId);

	if (input.days.length > 0) {
		const ops = input.days.map((day) => {
			const set: Record<string, unknown> = { syncedAt: now };
			for (const key of METRIC_KEYS) {
				if (day[key] !== undefined) set[key] = day[key];
			}
			return {
				updateOne: {
					filter: {
						userId: userObjectId,
						date: day.date,
						source: input.source,
					},
					update: { $set: set },
					upsert: true,
				},
			};
		});
		await WearableDaily.bulkWrite(ops, { ordered: false });
	}

	let sleepUpserted = 0;
	let sleepSkippedManual = 0;
	if (input.sleep.length > 0) {
		const dates = input.sleep.map((s) => s.date);
		const manual = await SleepLog.find({
			userId: userObjectId,
			date: { $in: dates },
			source: SleepSource.Manual,
		})
			.select("date")
			.lean();
		const manualDates = new Set(manual.map((m) => m.date));

		const nights = input.sleep.filter((s) => !manualDates.has(s.date));
		sleepSkippedManual = input.sleep.length - nights.length;

		if (nights.length > 0) {
			const sleepSource = SLEEP_SOURCE[input.source];
			const ops = nights.map((night) => ({
				updateOne: {
					// Never match a manual log: if one appeared since the read
					// above, the upsert hits the unique index and is dropped below.
					filter: {
						userId: userObjectId,
						date: night.date,
						source: { $ne: SleepSource.Manual },
					},
					update: {
						$set: {
							userId: userObjectId,
							date: night.date,
							bedtime: new Date(night.bedtime),
							wakeTime: new Date(night.wakeTime),
							durationMinutes: night.durationMinutes,
							source: sleepSource,
						},
					},
					upsert: true,
				},
			}));
			try {
				await SleepLog.bulkWrite(ops, { ordered: false });
				sleepUpserted = nights.length;
			} catch (error) {
				const writeErrors = (error as { writeErrors?: { code?: number }[] })
					.writeErrors;
				if (!writeErrors || writeErrors.some((e) => e.code !== 11000))
					throw error;
				sleepUpserted = nights.length - writeErrors.length;
				sleepSkippedManual += writeErrors.length;
			}
		}
	}

	await WearableConnection.updateOne(
		{ userId: userObjectId, source: input.source },
		{
			$set: { lastSyncedAt: now },
			$setOnInsert: { connectedAt: now },
		},
		{ upsert: true },
	);

	return { daysUpserted: input.days.length, sleepUpserted, sleepSkippedManual };
}

/**
 * Daily series between two dates (inclusive), one entry per day.
 *
 * A member could in principle have both sources (e.g. switched phones); for a
 * given day we report the source that recorded the most steps, which is the
 * one that was actually on their wrist.
 */
export async function getWearableSeries(
	userId: string,
	fromStr?: string,
	toStr?: string,
	daysCount = 14,
): Promise<{ from: string; to: string; daily: WearableDay[] }> {
	const to = toStr || formatDateInZone(new Date(), DEFAULT_TIMEZONE);
	const from =
		fromStr ||
		formatDateInZone(
			new Date(
				new Date(`${to}T12:00:00Z`).getTime() - (daysCount - 1) * 86400000,
			),
			"UTC",
		);

	const docs = await WearableDaily.find({
		userId: toObjectId(userId),
		date: { $gte: from, $lte: to },
	}).lean();

	const best = new Map<string, (typeof docs)[number]>();
	for (const doc of docs) {
		const current = best.get(doc.date);
		if (!current || (doc.steps ?? -1) > (current.steps ?? -1))
			best.set(doc.date, doc);
	}

	const daily: WearableDay[] = [];
	let cursor = new Date(`${from}T00:00:00Z`);
	const end = new Date(`${to}T00:00:00Z`);
	while (cursor <= end) {
		const date = cursor.toISOString().slice(0, 10);
		const doc = best.get(date);
		const day: WearableDay = { date, source: doc?.source ?? null };
		if (doc) {
			for (const key of METRIC_KEYS) {
				const v = doc[key];
				if (typeof v === "number") day[key] = v;
			}
		}
		daily.push(day);
		cursor = new Date(cursor.getTime() + 86400000);
	}

	return { from, to, daily };
}

export async function listConnections(userId: string) {
	return WearableConnection.find({ userId: toObjectId(userId) })
		.select("source connectedAt lastSyncedAt grantedTypes")
		.lean();
}

export async function connectSource(
	userId: string,
	source: WearableSource,
	grantedTypes: string[],
	now = new Date(),
) {
	return WearableConnection.findOneAndUpdate(
		{ userId: toObjectId(userId), source },
		{ $set: { grantedTypes }, $setOnInsert: { connectedAt: now } },
		{ upsert: true, new: true },
	).lean();
}

/**
 * Disconnecting a source deletes what came from it. Keeping a health history
 * from a source the member just unplugged is the wrong reading of "stop".
 */
export async function disconnectSource(userId: string, source: WearableSource) {
	const userObjectId = toObjectId(userId);
	await Promise.all([
		WearableConnection.deleteOne({ userId: userObjectId, source }),
		WearableDaily.deleteMany({ userId: userObjectId, source }),
		SleepLog.deleteMany({ userId: userObjectId, source: SLEEP_SOURCE[source] }),
	]);
}

/** Everything wearable-derived for a user. Used on consent withdrawal and account deletion. */
export async function purgeWearableDataForUser(
	userId: string | mongoose.Types.ObjectId,
) {
	const userObjectId = typeof userId === "string" ? toObjectId(userId) : userId;
	await Promise.all([
		WearableConnection.deleteMany({ userId: userObjectId }),
		WearableDaily.deleteMany({ userId: userObjectId }),
		SleepLog.deleteMany({
			userId: userObjectId,
			source: { $in: Object.values(SLEEP_SOURCE) },
		}),
	]);
}

export async function loadConsentSubject(userId: string) {
	return User.findById(userId)
		.select("age dateOfBirth healthDataConsent")
		.lean();
}
