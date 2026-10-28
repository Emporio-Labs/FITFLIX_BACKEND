import z from "zod";

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
	canAccessLeads: z.boolean().optional(),
	// The branch the trainer works at. "" / "none" / null = no branch; a value
	// must be an active Location (checked in the controller).
	locationId: z.preprocess(
		(v) => (v === "" || v === "none" ? null : v),
		z
			.string()
			.trim()
			.regex(/^[a-fA-F0-9]{24}$/, "Invalid location id")
			.nullable()
			.optional(),
	),
});

export const updateTrainerBodySchema = createTrainerBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateTrainerBody = z.infer<typeof createTrainerBodySchema>;
export type UpdateTrainerBody = z.infer<typeof updateTrainerBodySchema>;
