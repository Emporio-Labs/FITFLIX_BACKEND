import z from "zod";
import { ExpertType, SlotResourceType } from "../models/Enums";

const slotBodySchema = z.object({
	locationId: z.string().nullable().optional(),
	resourceType: z.nativeEnum(SlotResourceType).optional(),
	resourceId: z.string().nullable().optional(),
	durationMinutes: z.coerce.number().int().positive().optional(),
	date: z.coerce.date().optional(),
	isDaily: z.coerce.boolean().optional(),
	expertType: z.nativeEnum(ExpertType).optional(),
	startTime: z.string().min(1),
	endTime: z.string().min(1),
	capacity: z.coerce.number().int().positive().optional().default(1),
	remainingCapacity: z.coerce.number().int().nonnegative().optional(),
	isBooked: z.coerce.boolean().optional(),
});

export const createSlotBodySchema = slotBodySchema.superRefine(
	(payload, ctx) => {
		const isDaily = payload.isDaily ?? !payload.date;

		if (!isDaily && !payload.date) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["date"],
				message: "date is required when isDaily is false",
			});
		}

		const capacity = payload.capacity ?? 1;
		const remainingCapacity = payload.remainingCapacity ?? capacity;

		if (remainingCapacity > capacity) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["remainingCapacity"],
				message: "remainingCapacity cannot exceed capacity",
			});
		}
	},
);

export const updateSlotBodySchema = slotBodySchema
	.partial()
	.refine((payload) => Object.keys(payload).length > 0, {
		message: "At least one field is required",
	})
	.superRefine((payload, ctx) => {
		if (payload.isDaily === false && !payload.date) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["date"],
				message: "date is required when isDaily is false",
			});
		}

		if (
			typeof payload.capacity === "number" &&
			typeof payload.remainingCapacity === "number" &&
			payload.remainingCapacity > payload.capacity
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["remainingCapacity"],
				message: "remainingCapacity cannot exceed capacity",
			});
		}
	});

export const generateSlotsBodySchema = z.object({
	locationId: z.string().optional().nullable(),
	resourceType: z.nativeEnum(SlotResourceType).optional().default(SlotResourceType.NUTRITIONIST),
	resourceId: z.string().optional().nullable(),
	expertType: z.nativeEnum(ExpertType).optional(),
	isDaily: z.coerce.boolean().optional().default(true),
	replaceExisting: z.coerce.boolean().optional().default(false),
	dateFrom: z.coerce.date().optional(),
	dateTo: z.coerce.date().optional(),
	daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).optional(),
	windows: z
		.array(
			z.object({
				startTime: z.string().min(1),
				endTime: z.string().min(1),
			}),
		)
		.min(1, "At least one time window is required"),
	slotDurationMinutes: z.coerce.number().int().min(5).max(480),
	bufferMinutes: z.coerce.number().int().min(0).max(180).optional().default(0),
	capacity: z.coerce.number().int().min(1).optional().default(1),
	dryRun: z.coerce.boolean().optional().default(false),
}).superRefine((payload, ctx) => {
	if (!payload.isDaily) {
		if (!payload.dateFrom) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["dateFrom"],
				message: "dateFrom is required when isDaily is false",
			});
		}
		if (!payload.dateTo) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["dateTo"],
				message: "dateTo is required when isDaily is false",
			});
		}
		if (payload.dateFrom && payload.dateTo && payload.dateFrom > payload.dateTo) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["dateTo"],
				message: "dateTo must be on or after dateFrom",
			});
		}
	}
});

export const bulkDeleteSlotsBodySchema = z.object({
	slotIds: z.array(z.string().min(1)).min(1, "At least one slotId is required"),
});

export const bulkUpdateSlotsBodySchema = z.object({
	slotIds: z.array(z.string().min(1)).min(1, "At least one slotId is required"),
	capacity: z.coerce.number().int().min(1).optional(),
});

export type CreateSlotBody = z.infer<typeof createSlotBodySchema>;
export type UpdateSlotBody = z.infer<typeof updateSlotBodySchema>;
export type GenerateSlotsBody = z.infer<typeof generateSlotsBodySchema>;
export type BulkDeleteSlotsBody = z.infer<typeof bulkDeleteSlotsBodySchema>;
export type BulkUpdateSlotsBody = z.infer<typeof bulkUpdateSlotsBodySchema>;
