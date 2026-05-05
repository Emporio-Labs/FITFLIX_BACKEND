import z from "zod";
import { TodoStatus } from "../models/Enums";

export const createScheduleBodySchema = z.object({
	userId: z.string().min(1),
	scheduledDate: z.coerce.date(),
	status: z.coerce
		.number()
		.refine((value) => value in TodoStatus, {
			message: "Invalid schedule status",
		})
		.optional()
		.default(TodoStatus.Todo),
	todoIds: z.array(z.string().min(1)).optional().default([]),
});

export const updateScheduleBodySchema = z
	.object({
		scheduledDate: z.coerce.date().optional(),
		status: z.coerce
			.number()
			.refine((value) => value in TodoStatus, {
				message: "Invalid schedule status",
			})
			.optional(),
		todoIds: z.array(z.string().min(1)).optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const rescheduleBodySchema = z.object({
	newScheduledDate: z.coerce.date(),
});

export type CreateScheduleBody = z.infer<typeof createScheduleBodySchema>;
export type UpdateScheduleBody = z.infer<typeof updateScheduleBodySchema>;
export type RescheduleBody = z.infer<typeof rescheduleBodySchema>;
