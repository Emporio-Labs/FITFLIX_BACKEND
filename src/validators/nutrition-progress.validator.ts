import z from "zod";
import {
	objectIdString,
	optionalDate,
} from "./nutrition-shared.validator";

const nullableNumber = z.coerce
	.number()
	.min(0)
	.max(1000)
	.nullable()
	.optional();

export const progressBodySchema = z
	.object({
		planId: objectIdString.nullable().optional(),
		date: optionalDate,
		recordedAt: optionalDate,
		weight: z.coerce.number().min(0).max(1000).nullable().optional(),
		weightKg: z.coerce.number().min(0).max(1000).nullable().optional(),
		bodyFatPct: z.coerce.number().min(0).max(100).nullable().optional(),
		measurements: z
			.object({
				chestCm: nullableNumber,
				waistCm: nullableNumber,
				hipCm: nullableNumber,
				armCm: nullableNumber,
				thighCm: nullableNumber,
			})
			.optional(),
		photoUrls: z.array(z.string().trim().url()).max(10).optional(),
		notes: z.string().trim().max(2000).optional(),
		note: z.string().trim().max(2000).optional(),
	})
	.transform((v) => ({
		planId: v.planId,
		recordedAt: v.date ?? v.recordedAt,
		weightKg: v.weight ?? v.weightKg,
		bodyFatPct: v.bodyFatPct,
		measurements: v.measurements,
		photoUrls: v.photoUrls,
		note: v.notes ?? v.note,
	}));

export const progressListQuerySchema = z.object({
	planId: objectIdString.optional(),
	from: optionalDate,
	to: optionalDate,
});

export type ProgressBody = z.infer<typeof progressBodySchema>;
export type ProgressListQuery = z.infer<typeof progressListQuerySchema>;
