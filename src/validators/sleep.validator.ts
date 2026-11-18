import { z } from "zod";
import { SleepSource } from "../models/sleep-log.model";

const MAX_NIGHT_MS = 24 * 60 * 60 * 1000;
const FUTURE_SLACK_MS = 60 * 60 * 1000;
const toTime = (v: string | Date) =>
	(v instanceof Date ? v : new Date(v)).getTime();

export const logSleepSchema = z
	.object({
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
		// Prefer ISO with an offset ("…Z"). The second branch still accepts a
		// bare local time from older app builds, which the server then reads in
		// its own timezone.
		bedtime: z.union([z.string().datetime(), z.string().pipe(z.coerce.date())]),
		wakeTime: z.union([z.string().datetime(), z.string().pipe(z.coerce.date())]),
		durationMinutes: z.number().int().min(1).max(1440).optional(),
		source: z.nativeEnum(SleepSource).optional().default(SleepSource.Manual),
		qualityScore: z.number().int().min(1).max(100).optional(),
		notes: z.string().max(500).optional(),
	})
	// The old app put bedtime on the previous day even for 12:30 AM, saving a
	// 30.5-hour night. The model's max:1440 never caught it because
	// findOneAndUpdate skips schema validators, so the check lives here.
	.superRefine((v, ctx) => {
		const span = toTime(v.wakeTime) - toTime(v.bedtime);
		// A wake-up that hasn't happened yet (logging at 1 AM that you'll wake
		// at 7). An hour of slack covers phone clocks that run fast.
		if (toTime(v.wakeTime) > Date.now() + FUTURE_SLACK_MS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["wakeTime"],
				message: "wakeTime can't be in the future",
			});
			return;
		}
		if (!(span > 0)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["wakeTime"],
				message: "wakeTime must be after bedtime",
			});
		} else if (span >= MAX_NIGHT_MS) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["wakeTime"],
				message: "A night must be shorter than 24 hours",
			});
		}
	});

export const getSleepSeriesQuerySchema = z.object({
	from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
	days: z.preprocess(
		(v) => (v !== undefined ? Number(v) : undefined),
		z.number().int().min(1).max(365).optional(),
	),
});

export type LogSleepInput = z.infer<typeof logSleepSchema>;
export type GetSleepSeriesQuery = z.infer<typeof getSleepSeriesQuerySchema>;
