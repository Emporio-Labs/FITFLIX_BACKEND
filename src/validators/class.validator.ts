import z from "zod";

export const createClassBodySchema = z.object({
	name: z.string().trim().min(1, "Name is required and cannot be empty"),
	description: z.string().trim().default(""),
	mode: z.enum(["online", "offline", "hybrid"]).optional().default("offline"),
	sessionType: z.enum(["group_class", "live_stream", ""]).optional().default(""),
	instructor: z.string().optional().default("Staff"),
	// ObjectId string of the User account hosting this class.
	// Used for ZEGOCLOUD host vs audience role dispatch (GCLS-24).
	instructorUserId: z.string().nullable().optional().default(null),
	durationMinutes: z.coerce.number().optional().default(60),
	maxParticipants: z.coerce.number().optional().default(20),
	tags: z.array(z.string()).optional().default([]),
	scheduleInfo: z.string().optional().default(""),
	recurrenceRule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).optional().default("NONE"),
	schedulePattern: z.string().nullable().optional().default(null),
	scheduleType: z.string().optional().default("Fixed Session"),
	daysOfWeek: z.array(z.number().int().min(0).max(6)).optional().default([]),
	locationAddress: z.string().optional().default(""),
	streamRoomId: z.string().optional().default(""),
	enableWaitlist: z.boolean().optional().default(false),
	status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
	access: z.enum(["members_only", "open_to_all"]).optional().default("members_only"),
	bookingRequirement: z.enum(["free", "credits_required"]).optional().default("credits_required"),
	creditCost: z.coerce
		.number()
		.int("Credit cost must be an integer")
		.min(0, "Credit cost must be a non-negative integer (>= 0)"),
	bookingWindowValue: z.number().int().nonnegative().optional().default(72),
	bookingWindowUnit: z.enum(["hours", "days"]).optional().default("hours"),
	bookingCloseValue: z.preprocess(
		(val) => (val === "" || val === null || val === undefined ? null : Number(val)),
		z.number().int().nonnegative().nullable().optional().default(null)
	),
	bookingCloseUnit: z.preprocess(
		(val) => (val === "" || val === null || val === undefined ? null : val),
		z.enum(["minutes", "hours", "days"]).nullable().optional().default(null)
	),
	occurrenceLeadMinutes: z.preprocess(
		(val) => (val === "" || val === null || val === undefined ? 30 : Number(val)),
		z.number().int().nonnegative().optional().default(30)
	),
	isPublished: z.boolean().optional().default(true),
});

export const updateClassBodySchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(1, "Name is required and cannot be empty")
			.optional(),
		description: z.string().trim().optional(),
		mode: z.enum(["online", "offline", "hybrid"]).optional(),
		sessionType: z.enum(["group_class", "live_stream", ""]).optional(),
		instructor: z.string().optional(),
		instructorUserId: z.string().nullable().optional(),
		durationMinutes: z.coerce.number().optional(),
		maxParticipants: z.coerce.number().optional(),
		tags: z.array(z.string()).optional(),
		scheduleInfo: z.string().optional(),
		recurrenceRule: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
		schedulePattern: z.string().nullable().optional(),
		scheduleType: z.string().optional(),
		daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
		locationAddress: z.string().optional(),
		streamRoomId: z.string().optional(),
		enableWaitlist: z.boolean().optional(),
		status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
		access: z.enum(["members_only", "open_to_all"]).optional(),
		bookingRequirement: z.enum(["free", "credits_required"]).optional(),
		creditCost: z.coerce
			.number()
			.int("Credit cost must be an integer")
			.min(0, "Credit cost must be a non-negative integer (>= 0)")
			.optional(),
		bookingWindowValue: z.number().int().nonnegative().optional(),
		bookingWindowUnit: z.enum(["hours", "days"]).optional(),
		bookingCloseValue: z.preprocess(
			(val) => (val === "" || val === null || val === undefined ? null : Number(val)),
			z.number().int().nonnegative().nullable().optional()
		),
		bookingCloseUnit: z.preprocess(
			(val) => (val === "" || val === null || val === undefined ? null : val),
			z.enum(["minutes", "hours", "days"]).nullable().optional()
		),
		occurrenceLeadMinutes: z.preprocess(
			(val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
			z.number().int().nonnegative().optional()
		),
		isPublished: z.boolean().optional(),
	})
	.refine(
		(payload) => {
			return Object.keys(payload).length > 0;
		},
		{
			message: "At least one field must be provided for update",
		},
	);

export type CreateClassBody = z.infer<typeof createClassBodySchema>;
export type UpdateClassBody = z.infer<typeof updateClassBodySchema>;
