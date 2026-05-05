import z from "zod";

export const createAdminBodySchema = z.object({
	adminName: z.string().min(1),
	email: z.email(),
	phone: z.string().min(1),
	password: z.string().min(6),
});

export const updateAdminBodySchema = createAdminBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateAdminBody = z.infer<typeof createAdminBodySchema>;
export type UpdateAdminBody = z.infer<typeof updateAdminBodySchema>;
