import mongoose from "mongoose";
import { EventStatus, EventType } from "./Enums";
import { applyIdTransform } from "../utils/mongoose-serialization";

const ticketTierSchema = new mongoose.Schema(
	{
		tierId: { type: String, required: true },
		name: { type: String, required: true },
		badgeLabel: { type: String, default: "GENERAL PASS" },
		badgeColor: { type: String, default: "#10b981" },
		type: {
			type: String,
			enum: ["free", "rsvp", "paid"],
			default: "free",
			required: true,
		},
		price: { type: Number, default: 0 },
		creditCost: { type: Number, default: 0 },
		totalQuantity: { type: Number, required: true, default: 100 },
		soldQuantity: { type: Number, default: 0 },
		validFrom: { type: Date, default: Date.now },
		validUntil: { type: Date },
		perks: { type: [String], default: [] },
		maxTicketsPerUser: { type: Number, default: 2 },
	},
	{ _id: false },
);

const collaboratorSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		role: { type: String, default: "Co-Host" },
		logoUrl: { type: String, required: true },
		websiteUrl: { type: String, default: null },
	},
	{ _id: false },
);

const sponsorSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		logoUrl: { type: String, required: true },
		tier: { type: String, default: "Partner" },
	},
	{ _id: false },
);

const scheduleTimelineSchema = new mongoose.Schema(
	{
		time: { type: String, required: true },
		title: { type: String, required: true },
		description: { type: String, default: null },
		speaker: { type: String, default: null },
	},
	{ _id: false },
);

const fitflixEventSchema = new mongoose.Schema(
	{
		title: { type: String, required: true, trim: true },
		slug: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
			index: true,
		},
		tagline: { type: String, trim: true, default: null },
		description: { type: String, default: "" },
		eventType: {
			type: String,
			enum: Object.values(EventType),
			default: EventType.CommunityMeetup,
			required: true,
		},
		status: {
			type: String,
			enum: Object.values(EventStatus),
			default: EventStatus.Draft,
			required: true,
			index: true,
		},

		// Timing & Schedule
		startDate: { type: Date, required: true, index: true },
		endDate: { type: Date, required: true },
		reportingTime: { type: String, required: true, default: "09:00 AM IST" },
		scheduleTimeline: { type: [scheduleTimelineSchema], default: [] },

		// Offline Venue
		venue: {
			name: { type: String, required: true },
			address: { type: String, required: true },
			city: { type: String, required: true, default: "Bengaluru" },
			landmark: { type: String, default: null },
			googleMapsUrl: { type: String, default: null },
			locationId: {
				type: mongoose.Schema.Types.ObjectId,
				ref: "Location",
				default: null,
			},
		},

		// Attendance & Capacity
		totalCapacity: { type: Number, required: true, default: 100 },
		totalRegistered: { type: Number, default: 0 },
		totalCheckedIn: { type: Number, default: 0 },

		// Visual Assets & Badging
		coverImageUrl: { type: String, default: null },
		badgeWatermarkUrl: { type: String, default: null },
		collaborators: { type: [collaboratorSchema], default: [] },
		sponsors: { type: [sponsorSchema], default: [] },

		// Tiers
		ticketTiers: { type: [ticketTierSchema], default: [] },

		createdByAdminId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Admin",
			default: null,
		},
	},
	{ timestamps: true },
);

fitflixEventSchema.index({ status: 1, startDate: 1 });

applyIdTransform(fitflixEventSchema);

type FitflixEventDocument = mongoose.InferSchemaType<typeof fitflixEventSchema>;

export default (mongoose.models.FitflixEvent as mongoose.Model<FitflixEventDocument>) ||
	mongoose.model<FitflixEventDocument>("FitflixEvent", fitflixEventSchema);
