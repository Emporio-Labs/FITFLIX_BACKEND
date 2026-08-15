import z from "zod";

const optionalDate = z.preprocess(
	(val) => (val === "" || val === null || val === undefined ? null : val),
	z.coerce.date().nullable(),
);

/**
 * Event integrity, shared by create and update.
 *
 * A drop-in has no run and no cohort window — allowing those fields on one
 * would produce a class that looks bounded in the admin UI while still booking
 * per occurrence, which is the confusing half-state this guards against.
 */
export const refineEventFields = (
	payload: {
		format?: "drop_in" | "batch" | null;
		startDate?: Date | null;
		endDate?: Date | null;
		enrollmentOpensAt?: Date | null;
		enrollmentClosesAt?: Date | null;
	},
	ctx: z.RefinementCtx,
) => {
	const { format, startDate, endDate, enrollmentOpensAt, enrollmentClosesAt } =
		payload;

	if (format === "batch") {
		if (!startDate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["startDate"],
				message: "startDate is required for a batch",
			});
		}
		if (!endDate) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["endDate"],
				message: "endDate is required for a batch",
			});
		}
	}

	if (format === "drop_in") {
		for (const [field, value] of [
			["startDate", startDate],
			["endDate", endDate],
			["enrollmentOpensAt", enrollmentOpensAt],
			["enrollmentClosesAt", enrollmentClosesAt],
		] as const) {
			if (value) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `${field} applies to a batch, not a drop-in class`,
				});
			}
		}
	}

	if (startDate && endDate && endDate <= startDate) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["endDate"],
			message: "endDate must be after startDate",
		});
	}

	if (
		enrollmentOpensAt &&
		enrollmentClosesAt &&
		enrollmentClosesAt <= enrollmentOpensAt
	) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["enrollmentClosesAt"],
			message: "enrollmentClosesAt must be after enrollmentOpensAt",
		});
	}

	// Enrolling into a run that has already finished is never meaningful.
	if (enrollmentClosesAt && endDate && enrollmentClosesAt > endDate) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["enrollmentClosesAt"],
			message: "enrollmentClosesAt cannot be after endDate",
		});
	}
};

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
	imageUrl: z.string().trim().url().or(z.literal("")).optional().default(""),
	format: z.enum(["drop_in", "batch"]).optional().default("drop_in"),
	startDate: optionalDate.optional().default(null),
	endDate: optionalDate.optional().default(null),
	enrollmentOpensAt: optionalDate.optional().default(null),
	enrollmentClosesAt: optionalDate.optional().default(null),
}).superRefine(refineEventFields);

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
		imageUrl: z.string().trim().url().or(z.literal("")).optional(),
		format: z.enum(["drop_in", "batch"]).optional(),
		startDate: optionalDate.optional(),
		endDate: optionalDate.optional(),
		enrollmentOpensAt: optionalDate.optional(),
		enrollmentClosesAt: optionalDate.optional(),
	})
	.refine(
		(payload) => {
			return Object.keys(payload).length > 0;
		},
		{
			message: "At least one field must be provided for update",
		},
	)
	// A partial update only sees the fields that were sent, so this catches an
	// inconsistent pair arriving together. The controller re-checks the merged
	// document for the case where one half is already stored.
	.superRefine(refineEventFields);

/**
 * The event fields alone, for re-validating a merged document on update.
 *
 * `pickEventFields` drops keys the caller did not send so a spread merge does
 * not overwrite a stored value with `undefined`.
 */
export const eventFieldsSchema = z
	.object({
		format: z.enum(["drop_in", "batch"]).optional(),
		startDate: optionalDate.optional(),
		endDate: optionalDate.optional(),
		enrollmentOpensAt: optionalDate.optional(),
		enrollmentClosesAt: optionalDate.optional(),
	})
	.superRefine(refineEventFields);

const EVENT_FIELD_KEYS = [
	"format",
	"startDate",
	"endDate",
	"enrollmentOpensAt",
	"enrollmentClosesAt",
] as const;

export const pickEventFields = (
	source: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
	const picked: Record<string, unknown> = {};
	if (!source) return picked;
	for (const key of EVENT_FIELD_KEYS) {
		if (source[key] !== undefined) picked[key] = source[key];
	}
	return picked;
};

export type CreateClassBody = z.infer<typeof createClassBodySchema>;
export type UpdateClassBody = z.infer<typeof updateClassBodySchema>;
