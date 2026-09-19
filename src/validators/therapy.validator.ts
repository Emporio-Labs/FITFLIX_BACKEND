import z from "zod";

const locationId = z
	.string()
	.trim()
	.refine((v) => /^[0-9a-fA-F]{24}$/.test(v), "Expected an object id")
	.nullable()
	.optional();

export const createTherapyBodySchema = z.object({
	therapyName: z.string().min(1),
	therapyTime: z.coerce.number().positive(),
	creditCost: z.coerce.number().int().positive().optional().default(1),
	description: z.string().min(1),
	tags: z.array(z.string().min(1)).default([]),
	slots: z.array(z.string().min(1)).min(1),
	locationId,
});

export const updateTherapyBodySchema = z
	.object({
		therapyName: z.string().min(1).optional(),
		therapyTime: z.coerce.number().positive().optional(),
		creditCost: z.coerce.number().int().positive().optional(),
		description: z.string().min(1).optional(),
		tags: z.array(z.string().min(1)).optional(),
		slots: z.array(z.string().min(1)).min(1).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateTherapyBody = z.infer<typeof createTherapyBodySchema>;
export type UpdateTherapyBody = z.infer<typeof updateTherapyBodySchema>;
