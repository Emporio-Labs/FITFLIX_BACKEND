import mongoose from "mongoose";
import z from "zod";

// FX-17 — a Location id. Accepts any 24-char ObjectId string.
const objectIdString = z
	.string()
	.refine((v) => mongoose.Types.ObjectId.isValid(v), {
		message: "Invalid location id",
	});

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
	// Branch this coach works out of, and the full set of branches they may act
	// on (FX-17). `locationId` stays for back-compat; `branchIds` is the scope.
	locationId: objectIdString.optional(),
	branchIds: z.array(objectIdString).optional(),
});

export const updateTrainerBodySchema = createTrainerBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateTrainerBody = z.infer<typeof createTrainerBodySchema>;
export type UpdateTrainerBody = z.infer<typeof updateTrainerBodySchema>;
