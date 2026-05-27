import z from "zod";

export const dashboardMembersQuerySchema = z.object({
	search: z.string().trim().optional(),
	// "all" is accepted from the frontend as an explicit no-op and normalized
	// to undefined server-side so no $match is pushed.
	status: z
		.enum(["all", "pending", "booked", "assigned", "completed"])
		.optional()
		.transform((v) => (v === "all" ? undefined : v)),
	page: z.coerce.number().int().min(1).default(1),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type DashboardMembersQuery = z.infer<
	typeof dashboardMembersQuerySchema
>;
