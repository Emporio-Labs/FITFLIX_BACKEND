import z from "zod";
import { BookingStatus } from "../models/Enums";

export const createBookingBodySchema = z.object({
	bookingDate: z.coerce.date(),
	userId: z.string().min(1).optional(),
	slotId: z.string().min(1),
	serviceId: z.string().min(1),
	reportId: z.string().min(1).optional(),
	bypassCredits: z.coerce.boolean().optional().default(false),
	/** Admin-only: skip the booking window open/close check. */
	bypassBookingWindow: z.coerce.boolean().optional().default(false),
});

export const updateBookingBodySchema = z
	.object({
		bookingDate: z.coerce.date().optional(),
		slotId: z.string().min(1).optional(),
		serviceId: z.string().min(1).optional(),
		reportId: z.string().min(1).optional(),
		bypassBookingWindow: z.coerce.boolean().optional().default(false),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const changeBookingStatusBodySchema = z.object({
	status: z.coerce.number().refine((value) => value in BookingStatus, {
		message: "Invalid booking status",
	}),
});

export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;
export type UpdateBookingBody = z.infer<typeof updateBookingBodySchema>;
export type ChangeBookingStatusBody = z.infer<
	typeof changeBookingStatusBodySchema
>;
