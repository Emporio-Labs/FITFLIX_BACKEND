import { z } from "zod";
import { SleepSource } from "../models/sleep-log.model";

export const logSleepSchema = z.object({
	date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
	bedtime: z.union([z.string().datetime(), z.string().pipe(z.coerce.date())]),
	wakeTime: z.union([z.string().datetime(), z.string().pipe(z.coerce.date())]),
	durationMinutes: z.number().int().min(1).max(1440).optional(),
	source: z.nativeEnum(SleepSource).optional().default(SleepSource.Manual),
	qualityScore: z.number().int().min(1).max(100).optional(),
	notes: z.string().max(500).optional(),
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
