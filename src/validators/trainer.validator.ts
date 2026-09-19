import z from "zod";

const locationId = z
	.string()
	.trim()
	.refine((v) => /^[0-9a-fA-F]{24}$/.test(v), "Expected an object id")
	.nullable()
	.optional();

export const createTrainerBodySchema = z.object({
	trainerName: z.string().min(1),
	email: z.email(),
	phone: z.string().min(1),
	password: z.string().min(6),
	description: z.string().default(""),
	specialities: z.array(z.string().min(1)).default([]),
	imageUrl: z.string().optional().default(""),
	keySentence: z.string().optional().default(""),
	isActive: z.boolean().optional().default(true),
	locationId,
});

export const updateTrainerBodySchema = createTrainerBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateTrainerBody = z.infer<typeof createTrainerBodySchema>;
export type UpdateTrainerBody = z.infer<typeof updateTrainerBodySchema>;
