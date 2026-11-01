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

export const ticketTierSchema = z
	.object({
		tierId: z.string().trim().min(1, "tierId is required"),
		name: z.string().trim().min(1, "Tier name is required"),
		badgeLabel: z.string().trim().default("GENERAL PASS"),
		badgeColor: z.string().trim().default("#10b981"),
		type: z.enum(["free", "rsvp", "paid"]).default("free"),
		price: z.coerce.number().min(0, "Price cannot be negative").default(0),
		memberPrice: z.coerce.number().min(0, "Member price cannot be negative").optional().default(0),
		isMemberIncluded: z.boolean().optional().default(true),
		membersOnly: z.boolean().optional().default(false),
		creditCost: z.coerce.number().min(0, "Credit cost cannot be negative").default(0),
		totalQuantity: z.coerce.number().int().min(1, "Quantity must be at least 1").default(50),
		soldQuantity: z.coerce.number().int().min(0).default(0),
		validFrom: z.coerce.date().optional(),
		validUntil: z.coerce.date().optional(),
		perks: z.array(z.string().trim().min(1, "Perk description cannot be empty")).default([]),
		maxTicketsPerUser: z.coerce.number().int().min(1, "Max tickets must be at least 1").default(2),
	})
	.refine(
		(data) => {
			if ((data.type === "free" || data.type === "rsvp") && data.price > 0) {
				return false;
			}
			return true;
		},
		{
			message: "Free or RSVP passes cannot have a price greater than 0",
			path: ["price"],
		},
	)
	.refine(
		(data) => {
			if (data.validFrom && data.validUntil) {
				return data.validUntil >= data.validFrom;
			}
			return true;
		},
		{
			message: "validUntil cannot be before validFrom",
			path: ["validUntil"],
		},
	);

export const collaboratorSchema = z.object({
	name: z.string().trim().min(1, "Collaborator name is required"),
	role: z.string().trim().min(1, "Role is required").default("Co-Host"),
	logoUrl: z.string().trim().min(1, "Logo URL is required"),
	websiteUrl: optionalString,
});

export const sponsorSchema = z.object({
	name: z.string().trim().min(1, "Sponsor name is required"),
	logoUrl: z.string().trim().min(1, "Sponsor logo URL is required"),
	tier: z.string().trim().min(1, "Sponsor tier is required").default("Partner"),
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
	ticketTiers: z
		.array(ticketTierSchema)
		.refine(
			(tiers) => {
				const ids = tiers.map((t) => t.tierId);
				return new Set(ids).size === ids.length;
			},
			{ message: "Duplicate tierId found in ticketTiers", path: ["ticketTiers"] },
		)
		.optional(),
	collaborators: z.array(collaboratorSchema).optional(),
	sponsors: z.array(sponsorSchema).optional(),
};

export const createEventSchema = z
	.object(eventFields)
	.refine((data) => data.endDate >= data.startDate, {
		message: "endDate cannot be before startDate",
		path: ["endDate"],
	})
	.refine(
		(data) => {
			if (data.ticketTiers && data.ticketTiers.length > 0 && data.totalCapacity) {
				const sumQuantity = data.ticketTiers.reduce((acc, t) => acc + (t.totalQuantity || 0), 0);
				return sumQuantity <= data.totalCapacity;
			}
			return true;
		},
		{
			message: "Sum of ticket tier quantities exceeds total event capacity",
			path: ["ticketTiers"],
		},
	);

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
	)
	.refine(
		(data) => {
			if (data.ticketTiers && data.ticketTiers.length > 0 && data.totalCapacity) {
				const sumQuantity = data.ticketTiers.reduce((acc, t) => acc + (t.totalQuantity || 0), 0);
				return sumQuantity <= data.totalCapacity;
			}
			return true;
		},
		{
			message: "Sum of ticket tier quantities exceeds total event capacity",
			path: ["ticketTiers"],
		},
	);

export type CreateEventBody = z.infer<typeof createEventSchema>;
export type UpdateEventBody = z.infer<typeof updateEventSchema>;
export type TicketTierInput = z.infer<typeof ticketTierSchema>;
export type CollaboratorInput = z.infer<typeof collaboratorSchema>;
export type SponsorInput = z.infer<typeof sponsorSchema>;
