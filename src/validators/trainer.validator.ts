import z from "zod";

export const createTrainerBodySchema = z.object({
	trainerName: z.string().min(1),
	email: z.email(),
	phone: z.string().min(1),
	password: z.string().min(6),
	description: z.string().default(""),
	specialities: z.array(z.string().min(1)).default([]),
});

export const updateTrainerBodySchema = createTrainerBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateTrainerBody = z.infer<typeof createTrainerBodySchema>;
export type UpdateTrainerBody = z.infer<typeof updateTrainerBodySchema>;
