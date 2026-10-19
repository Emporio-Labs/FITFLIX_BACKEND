import z from "zod";

export const createServiceBodySchema = z.object({
	serviceName: z.string().min(1),
	serviceTime: z.coerce.number().positive(),
	creditCost: z.coerce.number().int().positive().default(1),
	description: z.string().min(1),
	tags: z.array(z.string().min(1)).default([]),
	slots: z.array(z.string().min(1)).min(1),
});

export const updateServiceBodySchema = z
	.object({
		serviceName: z.string().min(1).optional(),
		serviceTime: z.coerce.number().positive().optional(),
		creditCost: z.coerce.number().int().positive().optional(),
		description: z.string().min(1).optional(),
		tags: z.array(z.string().min(1)).optional(),
		slots: z.array(z.string().min(1)).min(1).optional(),
		isPaused: z.boolean().optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateServiceBody = z.infer<typeof createServiceBodySchema>;
export type UpdateServiceBody = z.infer<typeof updateServiceBodySchema>;
