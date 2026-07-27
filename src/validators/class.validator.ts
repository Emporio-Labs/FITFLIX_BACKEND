import z from "zod";

export const createClassBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required and cannot be empty"),
	description: z.string().trim().default(""),
	status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
	creditCost: z.coerce
		.number()
		.int("Credit cost must be an integer")
		.min(1, "Credit cost must be a positive integer (>= 1)"),
	isPublished: z.boolean().optional(),
});

export const updateClassBodySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Name is required and cannot be empty")
			.optional(),
		description: z.string().trim().optional(),
		status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
		creditCost: z.coerce
			.number()
			.int("Credit cost must be an integer")
			.min(1, "Credit cost must be a positive integer (>= 1)")
			.optional(),
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
