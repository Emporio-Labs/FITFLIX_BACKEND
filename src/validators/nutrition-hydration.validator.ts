import z from "zod";
import { optionalDate } from "./nutrition-shared.validator";

export const addHydrationBodySchema = z.object({
	amountMl: z.coerce.number().int().positive().max(20000),
	source: z.string().trim().min(1).max(50).optional(),
	date: optionalDate,
});

export const hydrationGoalBodySchema = z.object({
	goalMl: z.coerce.number().int().positive().max(20000),
	date: optionalDate,
});

export const hydrationQuerySchema = z.object({
	date: optionalDate,
});

export type AddHydrationBody = z.infer<typeof addHydrationBodySchema>;
export type HydrationGoalBody = z.infer<typeof hydrationGoalBodySchema>;
