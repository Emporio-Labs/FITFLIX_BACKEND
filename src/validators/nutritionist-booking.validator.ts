import mongoose from "mongoose";
import z from "zod";
import { AppointmentMode, NutritionistBookingStatus } from "../models/Enums";

const objectIdString = z
	.string()
	.trim()
	.refine((value) => mongoose.Types.ObjectId.isValid(value), {
		message: "Must be a valid ObjectId",
	});

export const bookNutritionistBodySchema = z.object({
	slotId: objectIdString,
	date: z.coerce.date(),
	appointmentMode: z.nativeEnum(AppointmentMode),
	clinicLocation: z.string().trim().min(1).optional(),
});

export const listNutritionistBookingsQuerySchema = z.object({
	status: z
		.preprocess(
			(v) =>
				typeof v === "string" ? v.toUpperCase() : v,
			z.nativeEnum(NutritionistBookingStatus).optional(),
		)
		.optional(),
	date: z.coerce.date().optional(),
});

export const rejectBookingBodySchema = z.object({
	reason: z.string().trim().min(1).max(500).optional(),
});

export const acceptBookingBodySchema = z.object({
	meetingLink: z.string().trim().url().optional(),
	clinicLocation: z.string().trim().min(1).optional(),
	calBookingId: z.string().trim().min(1).optional(),
});

export const availableSlotsQuerySchema = z.object({
	date: z.coerce.date(),
});

export type BookNutritionistBody = z.infer<typeof bookNutritionistBodySchema>;
export type ListNutritionistBookingsQuery = z.infer<
	typeof listNutritionistBookingsQuerySchema
>;
export type RejectBookingBody = z.infer<typeof rejectBookingBodySchema>;
export type AcceptBookingBody = z.infer<typeof acceptBookingBodySchema>;
export type AvailableSlotsQuery = z.infer<typeof availableSlotsQuerySchema>;
