import { z } from "zod";

const isoDay = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const listLoginEventsQuerySchema = z
	.object({
		from: isoDay,
		to: isoDay,
		role: z.string().trim().min(1).optional(),
		// Staff-only view: members (role "user") log in far more often and would
		// otherwise crowd staff out of the row cap.
		excludeRole: z.string().trim().min(1).optional(),
	})
	.refine((q) => q.from <= q.to, { message: "`from` must not be after `to`" });

export type ListLoginEventsQuery = z.infer<typeof listLoginEventsQuerySchema>;
