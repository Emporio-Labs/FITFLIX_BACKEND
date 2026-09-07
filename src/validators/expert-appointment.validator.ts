import { z } from "zod";

const optionalString = z
	.string()
	.trim()
	.transform((val) => (val === "" ? undefined : val))
	.optional();

export const acceptSportsScientistBookingSchema = z.object({
	// `meetingLink` is deliberately gone — an ONLINE booking gets an in-app
	// Zego room automatically (mirrors the nutritionist consult), so there is
	// nothing left for staff to paste in.
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
