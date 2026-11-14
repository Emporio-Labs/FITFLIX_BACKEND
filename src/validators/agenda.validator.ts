import { z } from "zod";

export const agendaQuerySchema = z.object({
	from: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}/, "from must be YYYY-MM-DD")
		.optional(),
	to: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}/, "to must be YYYY-MM-DD")
		.optional(),
	timezone: z.string().trim().optional(),
});

export type AgendaQueryInput = z.infer<typeof agendaQuerySchema>;
