import z from "zod";

const timeString = z
	.string()
	.trim()
	.regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm (24-hour)");

const operatingHoursSchema = z.object({
	dayOfWeek: z.coerce.number().int().min(0).max(6),
	openTime: timeString.default("06:00"),
	closeTime: timeString.default("22:00"),
	isClosed: z.boolean().default(false),
});

const graceGrantLimitsSchema = z.object({
	frontdeskMaxPerGrant: z.coerce.number().int().nonnegative().optional(),
	frontdeskMaxPerMonth: z.coerce.number().int().nonnegative().optional(),
	defaultExpiryDays: z.coerce.number().int().positive().optional(),
});

export const locationSettingsSchema = z.object({
	operatingHours: z.array(operatingHoursSchema).optional(),
	taxRatePercent: z.coerce.number().min(0).max(100).optional(),
	currency: z.string().trim().min(1).optional(),
	bookingWindowDays: z.coerce.number().int().positive().optional(),
	cancellationWindowHours: z.coerce.number().int().nonnegative().optional(),
	pauseMaxDaysPerTerm: z.coerce.number().int().nonnegative().optional(),
	slotDurationMinutes: z.coerce.number().int().min(5).optional(),
	bufferMinutes: z.coerce.number().int().nonnegative().optional(),
	graceGrantLimits: graceGrantLimitsSchema.optional(),
});

const addressSchema = z.object({
	line1: z.string().trim().optional(),
	line2: z.string().trim().optional(),
	city: z.string().trim().optional(),
	state: z.string().trim().optional(),
	pincode: z.string().trim().optional(),
	country: z.string().trim().optional(),
});

const geoSchema = z.object({
	lat: z.number().min(-90).max(90).nullable().optional(),
	lng: z.number().min(-180).max(180).nullable().optional(),
});

export const createLocationSchema = z.object({
	name: z.string().trim().min(1),
	// Restricted charset because the code shows up in URLs and reports.
	code: z
		.string()
		.trim()
		.toLowerCase()
		.min(2)
		.regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens only"),
	address: addressSchema.optional(),
	geo: geoSchema.optional(),
	phone: z.string().trim().optional(),
	email: z.string().trim().email().optional().or(z.literal("")),
	// Validated against the host's tz database rather than a hardcoded list.
	timezone: z
		.string()
		.trim()
		.default("Asia/Kolkata")
		.refine((tz) => {
			try {
				new Intl.DateTimeFormat("en-US", { timeZone: tz });
				return true;
			} catch {
				return false;
			}
		}, "Unknown IANA timezone"),
	isActive: z.boolean().optional(),
	settings: locationSettingsSchema.optional(),
});

export const updateLocationSchema = createLocationSchema
	.partial()
	.refine((p) => Object.keys(p).length > 0, {
		message: "At least one field is required",
	});

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type LocationSettingsInput = z.infer<typeof locationSettingsSchema>;
