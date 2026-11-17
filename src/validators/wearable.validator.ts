import { z } from "zod";
import { WearableSource } from "../models/wearable.model";

const dateStr = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const isoDate = z.string().datetime({ offset: true });

/** The app resends the last few days on every sync; cap one batch at 60 days. */
export const MAX_SYNC_DAYS = 60;

// Ranges are generous physiological bounds. Their job is to reject garbage
// (unit mix-ups, corrupted samples), not to second-guess a real reading.
const dailyMetricsSchema = z.object({
	date: dateStr,
	steps: z.number().int().min(0).max(150_000).optional(),
	activeCaloriesKcal: z.number().min(0).max(15_000).optional(),
	distanceMeters: z.number().min(0).max(300_000).optional(),
	restingHeartRate: z.number().min(20).max(250).optional(),
	avgHeartRate: z.number().min(20).max(250).optional(),
	maxHeartRate: z.number().min(20).max(250).optional(),
	workoutCount: z.number().int().min(0).max(50).optional(),
	workoutMinutes: z.number().min(0).max(1440).optional(),
	weightKg: z.number().min(20).max(400).optional(),
});

const sleepNightSchema = z
	.object({
		date: dateStr,
		bedtime: isoDate,
		wakeTime: isoDate,
		durationMinutes: z.number().int().min(1).max(1440),
	})
	.refine((s) => new Date(s.wakeTime) > new Date(s.bedtime), {
		message: "wakeTime must be after bedtime",
		path: ["wakeTime"],
	});

export const syncWearableSchema = z.object({
	source: z.nativeEnum(WearableSource),
	days: z.array(dailyMetricsSchema).max(MAX_SYNC_DAYS).default([]),
	sleep: z.array(sleepNightSchema).max(MAX_SYNC_DAYS).default([]),
});

export const connectWearableSchema = z.object({
	source: z.nativeEnum(WearableSource),
	grantedTypes: z.array(z.string().max(64)).max(32).default([]),
});

export const updateWearableConsentSchema = z
	.object({
		wearableSync: z.boolean().optional(),
		coachSharing: z.boolean().optional(),
	})
	.refine((v) => v.wearableSync !== undefined || v.coachSharing !== undefined, {
		message: "Provide wearableSync and/or coachSharing",
	});

export const wearableRangeQuerySchema = z.object({
	from: dateStr.optional(),
	to: dateStr.optional(),
	days: z.preprocess(
		(v) => (v !== undefined ? Number(v) : undefined),
		z.number().int().min(1).max(365).optional(),
	),
});

export type DailyMetricsInput = z.infer<typeof dailyMetricsSchema>;
export type SleepNightInput = z.infer<typeof sleepNightSchema>;
export type SyncWearableInput = z.infer<typeof syncWearableSchema>;
