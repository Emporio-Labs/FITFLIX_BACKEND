import { z } from "zod";
import { ExpertType } from "../models/Enums";

const expertTypeValues = Object.values(ExpertType) as [string, ...string[]];

// ─── Book ─────────────────────────────────────────────────────────────────────

export const bookAppointmentSchema = z.object({
	expertType: z.enum(expertTypeValues),
	slotStart: z
		.string()
		.trim()
		.min(1, "slotStart is required")
		.refine((v) => !Number.isNaN(Date.parse(v)), {
			message: "slotStart must be a valid ISO 8601 date-time",
		}),
	timezone: z
		.string()
		.trim()
		.min(1)
		.default(process.env.CAL_DEFAULT_TIMEZONE ?? "Asia/Kolkata"),
	idempotencyKey: z.string().trim().min(1).optional(),
});

export type BookAppointmentBody = z.infer<typeof bookAppointmentSchema>;

// ─── Reschedule ───────────────────────────────────────────────────────────────

export const rescheduleAppointmentSchema = z.object({
	slotStart: z
		.string()
		.trim()
		.min(1, "slotStart is required")
		.refine((v) => !Number.isNaN(Date.parse(v)), {
			message: "slotStart must be a valid ISO 8601 date-time",
		}),
	timezone: z
		.string()
		.trim()
		.min(1)
		.default(process.env.CAL_DEFAULT_TIMEZONE ?? "Asia/Kolkata"),
	reason: z.string().trim().max(500).optional(),
});

export type RescheduleAppointmentBody = z.infer<
	typeof rescheduleAppointmentSchema
>;

// ─── Cancel ───────────────────────────────────────────────────────────────────

export const cancelAppointmentSchema = z.object({
	reason: z.string().trim().max(500).optional(),
});

export type CancelAppointmentBody = z.infer<typeof cancelAppointmentSchema>;

// ─── Availability query ───────────────────────────────────────────────────────

export const availabilityQuerySchema = z.object({
	expertType: z.enum(expertTypeValues),
	startDate: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
	endDate: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD"),
	timezone: z
		.string()
		.trim()
		.min(1)
		.default(process.env.CAL_DEFAULT_TIMEZONE ?? "Asia/Kolkata"),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// ─── Admin list query ─────────────────────────────────────────────────────────

export const adminListQuerySchema = z.object({
	expertType: z.enum(expertTypeValues).optional(),
	status: z.string().trim().optional(),
	userId: z.string().trim().optional(),
	date: z
		.string()
		.trim()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
