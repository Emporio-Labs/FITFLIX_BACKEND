import z from "zod";
import { optionalDate } from "./nutrition-shared.validator";

export const addHydrationBodySchema = z
	.object({
		glasses: z.coerce.number().int().positive().max(80).optional(),
		ml: z.coerce.number().int().positive().max(20000).optional(),
		amountMl: z.coerce.number().int().positive().max(20000).optional(),
		source: z.string().trim().min(1).max(50).optional(),
		date: optionalDate,
	})
	.refine(
		(v) => v.ml !== undefined || v.glasses !== undefined || v.amountMl !== undefined,
		{ message: "Provide ml or glasses", path: ["ml"] },
	)
	.transform((v) => ({
		...v,
		amountMl: v.ml ?? v.amountMl ?? (v.glasses ?? 0) * 250,
	}));

export const hydrationGoalBodySchema = z.object({
	goalMl: z.coerce.number().int().positive().max(20000),
	date: optionalDate,
});

export const hydrationQuerySchema = z.object({
	date: optionalDate,
});

export type AddHydrationBody = z.infer<typeof addHydrationBodySchema>;
export type HydrationGoalBody = z.infer<typeof hydrationGoalBodySchema>;
