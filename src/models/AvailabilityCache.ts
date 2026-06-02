import mongoose from "mongoose";
import { ExpertType } from "./Enums";

const slotSchema = new mongoose.Schema(
	{
		start: { type: String, required: true }, // ISO 8601
		end: { type: String, required: true },
	},
	{ _id: false },
);

const availabilityCacheSchema = new mongoose.Schema(
	{
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			required: true,
		},
		eventTypeId: { type: String, required: true },
		// YYYY-MM-DD in the requested timezone
		dateKey: { type: String, required: true },
		timezone: { type: String, required: true },
		slots: { type: [slotSchema], default: [] },
		fetchedAt: { type: Date, required: true },
		// TTL index on this field — MongoDB removes the doc when expiresAt <= now
		expiresAt: { type: Date, required: true },
	},
	{ timestamps: false },
);

availabilityCacheSchema.index(
	{ expertType: 1, dateKey: 1, timezone: 1 },
	{ unique: true },
);
// TTL index — entries expire 60 seconds after expiresAt
availabilityCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type AvailabilityCacheDocument = mongoose.InferSchemaType<
	typeof availabilityCacheSchema
>;

export default (mongoose.models
	.AvailabilityCache as mongoose.Model<AvailabilityCacheDocument>) ||
	mongoose.model<AvailabilityCacheDocument>(
		"AvailabilityCache",
		availabilityCacheSchema,
	);
