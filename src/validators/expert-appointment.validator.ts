import { z } from "zod";

const optionalString = z
	.string()
	.trim()
	.transform((val) => (val === "" ? undefined : val))
	.optional();

export const acceptSportsScientistBookingSchema = z.object({
	meetingLink: optionalString,
	clinicLocation: optionalString,
	assignedExpertId: optionalString,
	assignedExpertName: optionalString,
});

export const rejectSportsScientistBookingSchema = z.object({
	rejectionReason: optionalString,
});

export type AcceptSportsScientistBookingBody = z.infer<
	typeof acceptSportsScientistBookingSchema
>;
export type RejectSportsScientistBookingBody = z.infer<
	typeof rejectSportsScientistBookingSchema
>;
