import z from "zod";

export const createGroupClassBodySchema = z.object({
	name: z.string().min(1),
	description: z.string().min(1),
	mode: z.enum(["online", "offline", "hybrid"]),
	instructor: z.string().min(1),
	durationMinutes: z.coerce.number().positive(),
	creditsRequired: z.coerce.number().int().positive().default(1),
	maxParticipants: z.coerce.number().int().positive().default(20),
	tags: z.array(z.string().min(1)).default([]),
	scheduleInfo: z.string().default(""),
	slots: z.array(z.string().min(1)).min(1),
	isActive: z.boolean().default(true),
});

export const updateGroupClassBodySchema = z
	.object({
		name: z.string().min(1).optional(),
		description: z.string().min(1).optional(),
		mode: z.enum(["online", "offline", "hybrid"]).optional(),
		instructor: z.string().min(1).optional(),
		durationMinutes: z.coerce.number().positive().optional(),
		creditsRequired: z.coerce.number().int().positive().optional(),
		maxParticipants: z.coerce.number().int().positive().optional(),
		tags: z.array(z.string().min(1)).optional(),
		scheduleInfo: z.string().optional(),
		slots: z.array(z.string().min(1)).min(1).optional(),
		isActive: z.boolean().optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export type CreateGroupClassBody = z.infer<typeof createGroupClassBodySchema>;
export type UpdateGroupClassBody = z.infer<typeof updateGroupClassBodySchema>;
