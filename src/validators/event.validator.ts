import mongoose from "mongoose";
import z from "zod";
import { EventStatus, EventType } from "../models/Enums";

const objectId = z
	.string()
	.trim()
	.refine((v) => mongoose.Types.ObjectId.isValid(v), "Expected a valid ObjectId");

const optionalString = z.preprocess(
	(v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
	z.string().trim().optional(),
);

export const venueSchema = z.object({
	name: z.string().trim().min(1, "Venue name is required"),
	address: z.string().trim().min(1, "Venue address is required"),
	city: z.string().trim().min(1, "Venue city is required").default("Bengaluru"),
	landmark: optionalString,
	googleMapsUrl: optionalString,
	locationId: objectId.optional(),
});

export const eventFields = {
	title: z.string().trim().min(1, "Event title is required"),
	slug: z
		.string()
		.trim()
		.regex(
			/^[a-z0-9-]+$/,
			"Slug can only contain lowercase alphanumeric characters and hyphens",
		)
		.optional(),
	tagline: optionalString,
	description: z.string().trim().default(""),
	eventType: z
		.nativeEnum(EventType)
		.default(EventType.CommunityMeetup),
	status: z
		.nativeEnum(EventStatus)
		.default(EventStatus.Draft),
	startDate: z.coerce.date({ message: "startDate must be a valid date" }),
	endDate: z.coerce.date({ message: "endDate must be a valid date" }),
	reportingTime: z
		.string()
		.trim()
		.min(1, "Reporting time is required")
		.default("09:00 AM IST"),
	venue: venueSchema,
	totalCapacity: z.coerce
		.number()
		.int()
		.min(1, "Capacity must be at least 1")
		.default(100),
	coverImageUrl: optionalString,
	badgeWatermarkUrl: optionalString,
};

export const createEventSchema = z
	.object(eventFields)
	.refine((data) => data.endDate >= data.startDate, {
		message: "endDate cannot be before startDate",
		path: ["endDate"],
	});

export const updateEventSchema = z
	.object(eventFields)
	.partial()
	.refine(
		(data) => {
			if (data.startDate && data.endDate) {
				return data.endDate >= data.startDate;
			}
			return true;
		},
		{
			message: "endDate cannot be before startDate",
			path: ["endDate"],
		},
	);

export type CreateEventBody = z.infer<typeof createEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;
