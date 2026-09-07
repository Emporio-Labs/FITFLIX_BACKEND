import { z } from "zod";
import { AppointmentMode, ExpertType } from "../models/Enums";

const timeString = z
	.string()
	.trim()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be HH:mm");

const shiftSchema = z.object({
	startTime: timeString,
	endTime: timeString,
});

const weeklySlotSchema = z.object({
	dayOfWeek: z.coerce.number().int().min(0).max(6),
	startTime: timeString.optional(),
	endTime: timeString.optional(),
	shifts: z.array(shiftSchema).optional(),
	isAvailable: z.boolean().default(true),
});

/**
 * Accepts all three `AppointmentMode` spellings on the wire — old clients still
 * send `OFFLINE` — and the service folds them to the two canonical values
 * before they are stored.
 */
export const updateExpertScheduleSchema = z
	.object({
		weeklySlots: z.array(weeklySlotSchema).optional(),
		slotDurationMinutes: z.coerce.number().int().min(15).max(120).optional(),
		bufferMinutes: z.coerce.number().int().min(0).max(60).optional(),
		blackoutDates: z
			.array(
				z.coerce.date({ message: "blackoutDates must be valid dates" }),
			)
			.optional(),
		supportedModes: z.array(z.nativeEnum(AppointmentMode)).optional(),
		maxAdvanceBookingDays: z.coerce.number().int().min(1).max(365).optional(),
		isActive: z.boolean().optional(),
	})
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	});

export const pooledAvailabilityQuerySchema = z.object({
	date: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}/, "date must be YYYY-MM-DD"),
	mode: z.nativeEnum(AppointmentMode).optional(),
	timeZone: z.string().trim().min(1).optional(),
});

export const expertTypeParamSchema = z.nativeEnum(ExpertType);

export type UpdateExpertScheduleBody = z.infer<
	typeof updateExpertScheduleSchema
>;
