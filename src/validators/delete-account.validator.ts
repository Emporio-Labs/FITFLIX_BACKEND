import z from "zod";
import { DeletionRequestStatus } from "../models/Enums";

export const createDeletionRequestSchema = z.object({
	firebaseIdToken: z
		.string()
		.trim()
		.min(1, "Authentication token is required"),
	reason: z
		.string()
		.trim()
		.max(500, "Reason cannot exceed 500 characters")
		.optional()
		.default(""),
	confirm: z.boolean().refine((val) => val === true, {
		message: "You must confirm that you understand this action is permanent.",
	}),
});

export const updateDeletionStatusSchema = z.object({
	status: z.enum(["Processed", "Cancelled"], {
		message: "Status must be either 'Processed' or 'Cancelled'",
	}),
});

export const listDeletionRequestsQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	status: z.nativeEnum(DeletionRequestStatus).optional(),
});

export type CreateDeletionRequest = z.infer<typeof createDeletionRequestSchema>;
export type UpdateDeletionStatus = z.infer<typeof updateDeletionStatusSchema>;
export type ListDeletionRequestsQuery = z.infer<
	typeof listDeletionRequestsQuerySchema
>;
