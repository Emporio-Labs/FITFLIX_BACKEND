import mongoose from "mongoose";

/**
 * Wearable data arrives from the phone's own health store, never from a
 * vendor cloud: Apple Health on iOS, Health Connect on Android. Watches
 * (Apple Watch, Fitbit, Galaxy Watch, Garmin…) sync into one of those, and the
 * app reads from there. Google Fit's APIs and the legacy Fitbit Web API are
 * both shut down, so they are deliberately not sources here.
 */
export enum WearableSource {
	AppleHealth = "APPLE_HEALTH",
	HealthConnect = "HEALTH_CONNECT",
}

/**
 * One document per user, IST calendar day and source. Re-sending a day
 * overwrites it (upsert), so the app can safely resend the last few days on
 * every sync without creating duplicates.
 */
const wearableDailySchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		/** Calendar day: YYYY-MM-DD */
		date: { type: String, required: true },
		source: {
			type: String,
			enum: Object.values(WearableSource),
			required: true,
		},
		steps: { type: Number, default: undefined, min: 0 },
		activeCaloriesKcal: { type: Number, default: undefined, min: 0 },
		distanceMeters: { type: Number, default: undefined, min: 0 },
		restingHeartRate: { type: Number, default: undefined, min: 0 },
		avgHeartRate: { type: Number, default: undefined, min: 0 },
		maxHeartRate: { type: Number, default: undefined, min: 0 },
		workoutCount: { type: Number, default: undefined, min: 0 },
		workoutMinutes: { type: Number, default: undefined, min: 0 },
		weightKg: { type: Number, default: undefined, min: 0 },
		syncedAt: { type: Date, required: true },
	},
	{ timestamps: true },
);

wearableDailySchema.index({ userId: 1, date: 1, source: 1 }, { unique: true });

export type WearableDailyDocument = mongoose.InferSchemaType<
	typeof wearableDailySchema
>;

export const WearableDaily =
	(mongoose.models.WearableDaily as mongoose.Model<WearableDailyDocument>) ||
	mongoose.model<WearableDailyDocument>("WearableDaily", wearableDailySchema);

/** Which health stores a member has connected, and when we last heard from each. */
const wearableConnectionSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		source: {
			type: String,
			enum: Object.values(WearableSource),
			required: true,
		},
		connectedAt: { type: Date, required: true },
		lastSyncedAt: { type: Date, default: null },
		/** Data types the member granted on the device, for support/debugging. */
		grantedTypes: { type: [String], default: [] },
	},
	{ timestamps: true },
);

wearableConnectionSchema.index({ userId: 1, source: 1 }, { unique: true });

export type WearableConnectionDocument = mongoose.InferSchemaType<
	typeof wearableConnectionSchema
>;

export const WearableConnection =
	(mongoose.models
		.WearableConnection as mongoose.Model<WearableConnectionDocument>) ||
	mongoose.model<WearableConnectionDocument>(
		"WearableConnection",
		wearableConnectionSchema,
	);
