import z from "zod";

export const createClassBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required and cannot be empty"),
	description: z.string().trim().default(""),
	mode: z.enum(["online", "offline", "hybrid"]).optional().default("offline"),
	instructor: z.string().optional().default("Staff"),
	durationMinutes: z.coerce.number().optional().default(60),
	maxParticipants: z.coerce.number().optional().default(20),
	tags: z.array(z.string()).optional().default([]),
	scheduleInfo: z.string().optional().default(""),
	locationAddress: z.string().optional().default(""),
	streamRoomId: z.string().optional().default(""),
	enableWaitlist: z.boolean().optional().default(false),
	status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
	creditCost: z.coerce
		.number()
		.int("Credit cost must be an integer")
		.min(1, "Credit cost must be a positive integer (>= 1)"),
	bookingWindowValue: z.number().int().positive().optional().default(72),
	bookingWindowUnit: z.enum(["hours", "days"]).optional().default("hours"),
	isPublished: z.boolean().optional().default(true),
});

export const updateClassBodySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Name is required and cannot be empty")
			.optional(),
		description: z.string().trim().optional(),
		mode: z.enum(["online", "offline", "hybrid"]).optional(),
		instructor: z.string().optional(),
		durationMinutes: z.coerce.number().optional(),
		maxParticipants: z.coerce.number().optional(),
		tags: z.array(z.string()).optional(),
		scheduleInfo: z.string().optional(),
		locationAddress: z.string().optional(),
		streamRoomId: z.string().optional(),
		enableWaitlist: z.boolean().optional(),
		status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
		creditCost: z.coerce
			.number()
			.int("Credit cost must be an integer")
			.min(1, "Credit cost must be a positive integer (>= 1)")
			.optional(),
		bookingWindowValue: z.number().int().positive().optional(),
		bookingWindowUnit: z.enum(["hours", "days"]).optional(),
		isPublished: z.boolean().optional(),
	})
	.refine(
		(payload) => {
			return Object.keys(payload).length > 0;
		},
		{
			message: "At least one field must be provided for update",
		},
	);

export type CreateClassBody = z.infer<typeof createClassBodySchema>;
export type UpdateClassBody = z.infer<typeof updateClassBodySchema>;
