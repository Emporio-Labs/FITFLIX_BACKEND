import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * A physical Fitflix branch.
 *
 * Settings are stored per-location rather than as global defaults with
 * overrides. That is a deliberate product decision, but it means a
 * company-wide policy change touches every branch — so new locations are
 * seeded from DEFAULT_LOCATION_SETTINGS, and an admin can clone a proven
 * branch's settings via POST /locations/:id/settings/copy-from/:sourceId.
 */

const operatingHoursSchema = new mongoose.Schema(
	{
		// 0 = Sunday … 6 = Saturday, matching Date#getDay and ExpertSchedule.
		dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
		openTime: { type: String, default: "06:00" },
		closeTime: { type: String, default: "22:00" },
		isClosed: { type: Boolean, default: false },
	},
	{ _id: false },
);

const graceGrantLimitsSchema = new mongoose.Schema(
	{
		// Caps apply to the frontdesk role only; admins are uncapped.
		frontdeskMaxPerGrant: { type: Number, default: 5, min: 0 },
		frontdeskMaxPerMonth: { type: Number, default: 20, min: 0 },
		// How long granted value lives if the caller doesn't specify.
		defaultExpiryDays: { type: Number, default: 30, min: 1 },
	},
	{ _id: false },
);

const locationSettingsSchema = new mongoose.Schema(
	{
		operatingHours: { type: [operatingHoursSchema], default: undefined },
		taxRatePercent: { type: Number, default: 18, min: 0 },
		currency: { type: String, default: "INR" },
		// How far ahead a member may book.
		bookingWindowDays: { type: Number, default: 30, min: 1 },
		// Cancel at least this many hours ahead to get a refund. Previously
		// hardcoded to 24 inside unified-booking.service.ts.
		cancellationWindowHours: { type: Number, default: 24, min: 0 },
		// Upper bound on how many days a member may freeze per term.
		pauseMaxDaysPerTerm: { type: Number, default: 30, min: 0 },
		slotDurationMinutes: { type: Number, default: 45, min: 5 },
		bufferMinutes: { type: Number, default: 15, min: 0 },
		graceGrantLimits: {
			type: graceGrantLimitsSchema,
			default: () => ({}),
		},
	},
	{ _id: false },
);

const addressSchema = new mongoose.Schema(
	{
		line1: { type: String, default: "" },
		line2: { type: String, default: "" },
		city: { type: String, default: "" },
		state: { type: String, default: "" },
		pincode: { type: String, default: "" },
		country: { type: String, default: "India" },
	},
	{ _id: false },
);

const geoSchema = new mongoose.Schema(
	{
		lat: { type: Number, default: null },
		lng: { type: Number, default: null },
	},
	{ _id: false },
);

const locationSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, trim: true },
		// Stable human-readable handle (e.g. "sainikpuri"). Used in URLs and
		// reports so branches stay recognisable without exposing ObjectIds.
		code: {
			type: String,
			required: true,
			unique: true,
			trim: true,
			lowercase: true,
		},
		address: { type: addressSchema, default: () => ({}) },
		geo: { type: geoSchema, default: () => ({}) },
		phone: { type: String, default: "" },
		email: { type: String, default: "" },
		// IANA zone. Every day-boundary calculation for this branch resolves
		// through here rather than the server's local clock.
		timezone: { type: String, default: "Asia/Kolkata" },
		isActive: { type: Boolean, default: true },
		settings: { type: locationSettingsSchema, default: () => ({}) },
	},
	{ timestamps: true },
);

locationSchema.index({ isActive: 1, name: 1 });

applyIdTransform(locationSchema);

/**
 * Seeded into every new location so a fresh branch is immediately usable.
 * Mirrors the schema defaults above; kept explicit so the API can return a
 * complete settings object rather than relying on Mongoose default expansion.
 */
export const DEFAULT_LOCATION_SETTINGS = {
	operatingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
		dayOfWeek,
		openTime: "06:00",
		closeTime: "22:00",
		isClosed: false,
	})),
	taxRatePercent: 18,
	currency: "INR",
	bookingWindowDays: 30,
	cancellationWindowHours: 24,
	pauseMaxDaysPerTerm: 30,
	slotDurationMinutes: 45,
	bufferMinutes: 15,
	graceGrantLimits: {
		frontdeskMaxPerGrant: 5,
		frontdeskMaxPerMonth: 20,
		defaultExpiryDays: 30,
	},
} as const;

type LocationDocument = mongoose.InferSchemaType<typeof locationSchema>;

export default (mongoose.models.Location as mongoose.Model<LocationDocument>) ||
	mongoose.model<LocationDocument>("Location", locationSchema);
