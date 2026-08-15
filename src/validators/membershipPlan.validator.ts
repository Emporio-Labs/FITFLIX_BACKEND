import z from "zod";

export const createMembershipPlanSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string().trim().optional(),
	price: z.number().nonnegative(),
	currency: z.string().trim().min(1).default("USD"),
	creditsIncluded: z.coerce.number().int().nonnegative().default(0),
	features: z.array(z.string().trim().min(1)).default([]),
	active: z.boolean().optional(),
	gymId: z.string().trim().min(1),
	durationMonths: z.coerce.number().int().positive().default(1),
	// `.nullable()` wraps the coercion so an explicit null short-circuits instead of
	// being coerced to 0 and failing `.positive()`. null clears a day-based duration.
	durationDays: z.coerce.number().int().positive().nullable().optional(),
	benefits: z.record(z.string(), z.any()).default({}),
});

export const updateMembershipPlanSchema = createMembershipPlanSchema
	.partial()
	.refine((p) => Object.keys(p).length > 0, {
		message: "At least one field is required",
	});

export type CreateMembershipPlan = z.infer<typeof createMembershipPlanSchema>;
export type UpdateMembershipPlan = z.infer<typeof updateMembershipPlanSchema>;
