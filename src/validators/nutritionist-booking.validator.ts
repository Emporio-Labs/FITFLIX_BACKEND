import { z } from "zod";
import { AppointmentMode } from "../models/Enums";

const optionalString = z
	.string()
	.trim()
	.transform((val) => (val === "" ? undefined : val))
	.optional();

export const bookNutritionistSchema = z.object({
	slotId: optionalString,
	date: z
		.string()
		.trim()
		.min(1, "Date is required")
		.refine((val) => !Number.isNaN(new Date(val).getTime()), {
			message: "Invalid date format",
		}),
	startTime: optionalString,
	endTime: optionalString,
	appointmentMode: z.nativeEnum(AppointmentMode).default(AppointmentMode.ONLINE),
	clinicLocation: optionalString,
	notes: optionalString,
});

export const acceptNutritionistBookingSchema = z.object({
	meetingLink: optionalString,
	clinicLocation: optionalString,
	assignedNutritionistId: optionalString,
	assignedNutritionistName: optionalString,
});

export const switchToOnlineSchema = z.object({
	notes: optionalString,
});

/**
 * Either a legacy `slotId` (the deployed member app still books that way) or a
 * `startTime` from pooled expert availability. One of the two is required —
 * without a time there is nothing to move the appointment to.
 */
export const rescheduleNutritionistBookingSchema = z
	.object({
		slotId: optionalString,
		startTime: optionalString,
		endTime: optionalString,
		date: optionalString,
		appointmentMode: z.nativeEnum(AppointmentMode).optional(),
	})
	.refine((payload) => Boolean(payload.slotId || payload.startTime), {
		message: "Either slotId or startTime is required",
		path: ["startTime"],
	});

export const cancelNutritionistBookingSchema = z.object({
	reason: optionalString,
});

export type BookNutritionistBody = z.infer<typeof bookNutritionistSchema>;
export type AcceptNutritionistBookingBody = z.infer<
	typeof acceptNutritionistBookingSchema
>;
export type SwitchToOnlineBody = z.infer<typeof switchToOnlineSchema>;
export type CancelNutritionistBookingBody = z.infer<
	typeof cancelNutritionistBookingSchema
>;
export type RescheduleNutritionistBookingBody = z.infer<
	typeof rescheduleNutritionistBookingSchema
>;
