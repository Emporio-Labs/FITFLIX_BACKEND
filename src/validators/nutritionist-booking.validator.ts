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

export const rescheduleNutritionistBookingSchema = z.object({
	slotId: z.string().trim().min(1, "slotId is required"),
	date: optionalString,
});

export type BookNutritionistBody = z.infer<typeof bookNutritionistSchema>;
export type AcceptNutritionistBookingBody = z.infer<
	typeof acceptNutritionistBookingSchema
>;
export type SwitchToOnlineBody = z.infer<typeof switchToOnlineSchema>;
