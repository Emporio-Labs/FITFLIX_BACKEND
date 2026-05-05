import z from "zod";

const slotBodySchema = z.object({
	date: z.coerce.date().optional(),
	isDaily: z.coerce.boolean().optional(),
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

export type CreateSlotBody = z.infer<typeof createSlotBodySchema>;
export type UpdateSlotBody = z.infer<typeof updateSlotBodySchema>;
