import z from "zod";

export const registerEventSchema = z.object({
	tierId: z.string().trim().min(1, "tierId is required"),
	attendeeName: z.string().trim().min(1, "Attendee name is required"),
	attendeeEmail: z.string().trim().email("Please provide a valid email address").toLowerCase(),
	attendeePhone: z
		.string()
		.trim()
		.min(7, "Phone number must be at least 7 digits")
		.max(15, "Phone number is too long"),
	answers: z.record(z.string().trim(), z.string().trim()).optional().default({}),
	paymentReference: z.string().trim().optional(),
});

export const verifyCheckInSchema = z.object({
	payload: z.string().trim().min(1, "QR payload or ticket ID is required"),
	eventId: z.string().trim().optional(),
});

export type RegisterEventBody = z.infer<typeof registerEventSchema>;
export type VerifyCheckInBody = z.infer<typeof verifyCheckInSchema>;
