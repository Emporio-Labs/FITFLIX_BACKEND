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

export const progressBodySchema = z.object({
	planId: objectIdString.nullable().optional(),
	recordedAt: optionalDate,
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
	note: z.string().trim().max(2000).optional(),
});

export const progressListQuerySchema = z.object({
	planId: objectIdString.optional(),
	from: optionalDate,
	to: optionalDate,
});

export type ProgressBody = z.infer<typeof progressBodySchema>;
export type ProgressListQuery = z.infer<typeof progressListQuerySchema>;
